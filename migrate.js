import debug from 'debug';
import { fetchCustomFields, fetchTestCases, fetchTestCase } from './jira.js';
import { fetchRepository, fetchTestsFromFolder, fetchSteps, downloadAttachment } from './xray.internal.js';
import { getTestomatioEndpoints, loginToTestomatio, uploadFile, fetchFromTestomatio, postToTestomatio, putToTestomatio } from './testomatio.js';

const logData = debug('testomatio:xray:migrate');

export default async function migrateTestCases() {

  const {
    postSuiteEndpoint,
    postTestEndpoint,
    postJiraIssueEndpoint,
    postIssueLinkEndpoint,
    postLabelEndpoint,
    postLabelLinkEndpoint,
  } = getTestomatioEndpoints();

  // await fetchCustomFields();
  // API endpoints

  // IF XRAY API IS NOT AVAILABLE WE CAN IMPORT TEST CASES ONLY
  // const testCases = await fetchTestCases();
  
  // const repositories = await fetchFromXRay(getXRayEndpoints().getTestRepositories);
  const repository = await fetchRepository();
  
  await loginToTestomatio();

  const folders = repository.folders;

  console.log("Creating suites...", folders.length - 1);

  const foldersMap = {};
  const filesMap = {};

  for (const folder of folders) {
    if (folder.folderId === '-1') continue;

    const isFolder = folder.folders.length > 0;

    const suiteData = {
      title: folder.name,
      'file-type': isFolder ? 'folder' : 'file',      
    }

    const testomatioSuite = await postToTestomatio(postSuiteEndpoint, 'suites', suiteData);

    if (isFolder) {
      foldersMap[folder.folderId] = testomatioSuite.id;
    } else {
      filesMap[folder.folderId] = testomatioSuite.id;
    }
    
    logData('Suite created:', testomatioSuite.attributes.title);

    if (isFolder && folder.testsCount > 0) {
      suiteData['file-type'] = 'file';
      suiteData['parent-id'] = testomatioSuite.id;
      const testomatioFileSuite = await postToTestomatio(postSuiteEndpoint, 'suites', suiteData);
      filesMap[folder.folderId] = testomatioFileSuite.id;

      logData('Suite (file) created:', testomatioSuite.attributes.title);
    }

  }

  for (const folder of folders.filter(f => f.folderId !== '-1' && f.parentFolderId !== '-1')) {
    
    const parentId = foldersMap[folder.parentFolderId];
    const suiteId = foldersMap[folder.folderId] || filesMap[folder.folderId];

    if (!suiteId) continue;
  
    await putToTestomatio(postSuiteEndpoint, 'suites', suiteId, { 'parent-id': parentId });
  }

  logData('Suites created:', foldersMap, filesMap);
  // structure created, now upload test cases

  for (const folder of folders) {
    const folderData = await fetchTestsFromFolder(folder.folderId);
    const suiteId = filesMap[folder.folderId];

    if (!folderData.foldersTests) continue;

    for (const ft of folderData.foldersTests) {
      for (const testId of ft.tests) {

        const test = await fetchTestCase(testId);

        // pre-conditions?
        if (!test) {
          // WHY??
          continue;
        }

        if (test.type !== 'Test') {
          console.log('Skipping', test.type, "[Not Supported]: " , test.key);
          logData('Skipping test:', test.summary);
          continue;
        }
        
        let steps;
        try {
          steps = await fetchSteps(testId);
          logData('Steps fetched:', steps.length);
        } catch (_err) {
          continue;
        }

        const testomatioTest = await postToTestomatio(postTestEndpoint, 'tests', {
          title: test.summary,
          'suite-id': suiteId,
          description: test.description,
          priority: convertPriority(test.priority),
        });

        logData('Test created:', testomatioTest.attributes.title);

        let description = test.description;

        for (const fileName in test.attachments) {
          const filePath = test.attachments[fileName];
          const attachmentUrl = await uploadFile(testomatioTest.id, filePath, {
            name: fileName,
          });

          if (fileName.endsWith('.png') || fileName.endsWith('.jpg')) {
            description = description.replaceAll(`![](${fileName})`, `![](${attachmentUrl})`); 
          } else {
            description = description.replaceAll(`![](${fileName})`, `[Attachment](${attachmentUrl})`);
          }          
        }

        if (steps.length) {
          description += '\n\n';
          description += '## Steps\n\n';
          description += steps.map((step, index) => {
            const stepLines = [];
            stepLines.push(`* ${step.action}`);            
            if (step.data) stepLines.push("```\n" + step.data.replaceAll('{noformat}', '').replaceAll('\{', '{') + "\n```");
            if (step.result) stepLines.push("*Expected*: " + step.result);
            return stepLines.join('\n');
          }).join('\n\n');

          const attachments = steps.map(step => step.attachments).flat();

          for (const attachment of attachments) {
            const filePath = await downloadAttachment(attachment);

            const attachmentUrl = await uploadFile(testomatioTest.id, filePath, {
              name: attachment.filename,
            });

            if (attachment.filename.endsWith('.png') || attachment.filename.endsWith('.jpg')) {
              description = description.replaceAll(`!xray-attachment://${attachment.id}|`, `![](${attachmentUrl})`); 
            } else {
              description = description.replaceAll(`!xray-attachment://${attachment.id}|`, `[Attachment](${attachmentUrl})`);
            }
          }
        }

        if (description !== test.description) await putToTestomatio(postTestEndpoint, 'tests', testomatioTest.id, {
          description,
        });        
      }
    }
  }


  // fetch each folder's tests

}

function convertPriority(priority) {
  switch (priority) {
    case 'Critical':
    case 'Blocker':
      return 'Blocker';
    case 'Highest':
      return 'important';
    case 'High':
      return 'high';
    case 'Medium':
      return 'normal';
    case 'Low':
    case 'Lowest':
      return 'low';
    default:
      return 'normal';
  }
}
