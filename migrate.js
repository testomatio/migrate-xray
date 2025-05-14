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
      'file-type': 'folder',
    }

    const testomatioSuite = await postToTestomatio(postSuiteEndpoint, 'suites', suiteData);

    if (isFolder) {
      foldersMap[folder.folderId] = testomatioSuite?.id;
    } else {
      filesMap[folder.folderId] = testomatioSuite?.id;
    }

    logData('Suite created:', testomatioSuite?.attributes?.title);
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

        if (!['Test', 'XRay Test'].includes(test.type)) {
          console.log('Skipping', testId, `Test type '${test.type}' is not considered for exporting. Edit migrate.js file change that`);
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

        // if there is no steps we create a new suite and then a single test in that suite
        // if there are steps, we need to create a suite, and each step is created as a test
        const suiteData = {
          title: test.summary,
          'file-type': 'file',
          'parent-id': suiteId || rootSuiteId,
          description: steps.length ? test.description : '',
        }

        // create a suite instead of a test
        const testomatioSuite = await postToTestomatio(postSuiteEndpoint, 'suites', suiteData);

        testsMap[testId] = testomatioSuite?.id;

        logData('Suite created:', testomatioSuite?.attributes?.title);


        // if there is no steps ==> we create a test case
        if (!steps.length) {
          const testomatioTest = await postToTestomatio(postTestEndpoint, 'tests', {
            title: test.summary,
            'suite-id': testomatioSuite?.id,
            description,
          });

          testsCreated++;

          let description = test.description;

          // update attachments
          for (const fileName in test.attachments) {
            const filePath = test.attachments[fileName];
            const attachmentUrl = await uploadFile(testomatioTest?.id, filePath, {
              name: fileName,
            });

            if (!description) continue;

            if (fileName.endsWith('.png') || fileName.endsWith('.jpg')) {
              description = description.replaceAll(`![](${fileName})`, `![](${attachmentUrl})`);
            } else {
              description = description.replaceAll(`![](${fileName})`, `[Attachment](${attachmentUrl})`);
            }
          }

          testsMap[testId] = testomatioTest?.id;

          if (test.description !== description) await putToTestomatio(postTestEndpoint, 'tests', testomatioTest?.id, {
            // params,
            description,
          });

          continue;
        }

        // if there are tests we create a new test for each step
        for (const step of steps) {
          let description = "";
          let title;

          if (!step.action && step.callTestIssueId) {
            continue;
          }

          // this is how we form test description
          description = step.action;
          title = description.split('\n')[0]?.trim()?.replace(/Scenario \d*/,'')

          if (!title) {
            debug('Empty step/scenario')
            continue;
          }

          if (step.data) description += "### Data\n```\n" + step.data.replaceAll('{noformat}', '').replaceAll('\\{', '{') + "\n```";
          if (step.result) description += "\n### Expected Result\n" + step.result;

          const testomatioTest = await postToTestomatio(postTestEndpoint, 'tests', {
            title,
            'suite-id': testomatioSuite?.id,
            description,
          });

          testsCreated++;

          // we update attachments
          const attachments = step.attachments;
          let currentDescription = description;

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

          if (currentDescription !== description) await putToTestomatio(postTestEndpoint, 'tests', testomatioTest?.id, {
            // params,
            description,
          });
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
