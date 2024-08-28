import debug from 'debug';
import { fetchCustomFields, fetchTestCase } from './jira.js';
import { fetchRepository, fetchTestsFromFolder, fetchSteps, fetchParams, fetchExamples, fetchPreconditions, downloadAttachment } from './xray.internal.js';
import { getTestomatioEndpoints, loginToTestomatio, uploadFile, fetchFromTestomatio, postToTestomatio, putToTestomatio } from './testomatio.js';

const logData = debug('testomatio:xray:migrate');

export default async function migrateTestCases() {

  const {
    postSuiteEndpoint,
    postTestEndpoint,
    postExampleEndpoint,
    postJiraIssueEndpoint,
    postIssueLinkEndpoint,
    postLabelEndpoint,
    postLabelLinkEndpoint,
  } = getTestomatioEndpoints();

  // in case custom fields needed
  // await fetchCustomFields();

  // IF XRAY API IS NOT AVAILABLE WE CAN IMPORT TEST CASES ONLY
  // const testCases = await fetchTestCases();

  // const repositories = await fetchFromXRay(getXRayEndpoints().getTestRepositories);
  const repository = await fetchRepository();

  await loginToTestomatio();

  let folders = repository.folders;

  if (process.env.XRAY_FOLDER_ID) {
    console.log('Importing single folder', process.env.XRAY_FOLDER_ID)
    folders = findFolderById(folders, process.env.XRAY_FOLDER_ID);
    if (!folders.length) throw new Error(`Folder with ID ${process.env.XRAY_FOLDER_ID} not found`);
  }

  console.log("Creating suites...");

  const foldersMap = {};
  const filesMap = {};
  const testsMap = {};

  for (const folder of folders) {
    if (folder.folderId === '-1') continue;

    const isFolder = folder.folders.length > 0;

    const suiteData = {
      title: folder.name,
      'file-type': isFolder ? 'folder' : 'file',
    }

    const testomatioSuite = await postToTestomatio(postSuiteEndpoint, 'suites', suiteData);

    if (isFolder) {
      foldersMap[folder.folderId] = testomatioSuite?.id;
    } else {
      filesMap[folder.folderId] = testomatioSuite?.id;
    }

    logData('Suite created:', testomatioSuite?.attributes?.title);

    if (isFolder && folder.testsCount > 0) {
      suiteData['file-type'] = 'file';
      suiteData['parent-id'] = testomatioSuite?.id;
      const testomatioFileSuite = await postToTestomatio(postSuiteEndpoint, 'suites', suiteData);
      filesMap[folder.folderId] = testomatioFileSuite?.id;

      logData('Suite (file) created:', testomatioSuite?.attributes?.title);
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

  let testsCreated = 0;

  console.log('Creating tests...');

  let rootSuiteId;

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
          // console.log('Skipping', test.type, "[Not Supported]: " , test.key);
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


        let preconditions = [];
        try {
          const preconditionIds = await fetchPreconditions(testId);
          for (const preconditionId of preconditionIds) {
            const preconditionData = await fetchTestCase(preconditionId);
            preconditions.push(preconditionData);
          }
          logData('Preconditions fetched:', preconditions.length);
        } catch (_err) {
        }

        if (!suiteId && !rootSuiteId) {
          const testomatioRootSuite = await postToTestomatio(postSuiteEndpoint, 'suites', {
            title: 'Root',
            'file-type': 'file',
            position: 1,
            emoji: '📂',
          });

          rootSuiteId = testomatioRootSuite?.id;
        }

        const testomatioTest = await postToTestomatio(postTestEndpoint, 'tests', {
          title: test.summary,
          'suite-id': suiteId || rootSuiteId,
          description: test.description,
          priority: convertPriority(test.priority),
        });

        testsMap[testId] = testomatioTest?.id;

        testsCreated++;

        logData('Test created:', testomatioTest?.attributes?.title);

        let description = test.description;

        for (const fileName in test.attachments) {
          const filePath = test.attachments[fileName];
          const attachmentUrl = await uploadFile(testomatioTest?.id, filePath, {
            name: fileName,
          });

          if (fileName.endsWith('.png') || fileName.endsWith('.jpg')) {
            description = description.replaceAll(`![](${fileName})`, `![](${attachmentUrl})`);
          } else {
            description = description.replaceAll(`![](${fileName})`, `[Attachment](${attachmentUrl})`);
          }
        }

        if (preconditions.length) {
          let preconditionText = `## Preconditions\n\n`;

          preconditionText += preconditions.map(p => `#### ${p.summary}\n\n${p.description}`).join('\n\n');

          description = preconditionText + description;
        }

        if (steps.length) {
          description += '\n\n';
          description += '## Steps\n\n';
          description += steps.map((step, index) => {
            if (!step.action && step.callTestIssueId) {
              if (!testsMap[step.callTestIssueId]) return "* !!![steps from a missing XRay test]]]!!!"

              return `* Steps from @T${testsMap[step.callTestIssueId]}`;
            }
            const stepLines = [];
            stepLines.push(`* ${step.action}`);
            if (step.data) stepLines.push("```\n" + step.data.replaceAll('{noformat}', '').replaceAll('\\{', '{') + "\n```");
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

        let params;
        // FETCH PARAMS IS NOT IMPLEMENTED DUE API LIMITATION
        // params = await fetchParams(testId)

        if (description !== test.description) await putToTestomatio(postTestEndpoint, 'tests', testomatioTest?.id, {
          // params,
          description,
        });

        if (params) {
          // FETCH EXAMPLES IS NOT IMPLEMENTED DUE API LIMITATION
          // const examples = await fetchExamples(testId);
          // console.log('examples');

          // postToTestomatio(postExampleEndpoint, 'example', {
          //   test_id: testomatioTest.id,
          //   data: {
          //      ....
          //   }
          // })
        }
      }
    }
  }

  console.log('Tests created', testsCreated);
  console.log('All preconditions were prepended to tests');
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


function findFolderById(folders, folderId) {
    let folderMap = {};

    // Create a map of folders by their IDs
    folders.forEach(folder => {
        folderMap[folder.folderId] = folder;
    });

    // Helper function to find all descendants
    function getDescendants(folder) {
        let descendants = [];

        function addDescendants(currentFolder) {
            if (currentFolder.folders && currentFolder.folders.length) {
                currentFolder.folders.forEach(id => {
                    let childFolder = folderMap[id];
                    if (childFolder) {
                        descendants.push(childFolder);
                        addDescendants(childFolder);
                    }
                });
            }
        }

        addDescendants(folder);
        return descendants;
    }

    // Find the folder by ID
    let targetFolder = folderMap[folderId];
    if (!targetFolder) {
        return null; // Folder not found
    }

    // Get all parents and descendants
    let descendants = getDescendants(targetFolder);

    return [targetFolder, ...descendants];
}
