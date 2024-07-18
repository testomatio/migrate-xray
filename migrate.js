import debug from 'debug';
import { getTestRailUrl, getTestRailEndpoints, fetchFromTestRail, downloadFile } from './testrail.js';
import { getTestomatioEndpoints, loginToTestomatio, uploadFile, fetchFromTestomatio, postToTestomatio, putToTestomatio } from './testomatio.js';

const logData = debug('testomatio:testrail:migrate');

let suiteId = process.env.TESTRAIL_SUITE_ID || null; // set to null to migrate all suites

const FIELD_TYPES = {
  1: 'String',
  2: 'Integer',
  3: 'Text', // as Description
  4: 'URL', // as Description
  5: 'Checkbox', // as Label
  6: 'Dropdown',
  7: 'User', // NOT SUPPORTED
  8: 'Date', // NOT SUPPORTED
  9: 'Milestone', // NOT SUPPORTED
  10: 'Steps',  // as Description
  12: 'Multi-select', // NOT SUPPORTED
}

export default async function migrateTestCases() {
  // API endpoints
  const { 
    getSuitesEndpoint, 
    getSuiteEndpoint,
    getSectionsEndpoint, 
    getCasesEndpoint,
    getCaseFieldsEndpoint,
    getAttachmentsEndpoint, 
    downloadAttachmentEndpoint,
    getPrioritesEndpoint,
  } = getTestRailEndpoints();
  
  const {
    postSuiteEndpoint,
    postTestEndpoint,
    postJiraIssueEndpoint,
    postIssueLinkEndpoint,
    postLabelEndpoint,
    postLabelLinkEndpoint,
  } = getTestomatioEndpoints();
  
  try {
    await loginToTestomatio();

    const labelsMap = {};
    const labelValuesMap = {};
    
    const priorities = convertPriorities(await fetchFromTestRail(getPrioritesEndpoint));
    logData('Priorities', priorities);
    
    const fields = await fetchFromTestRail(getCaseFieldsEndpoint);
    console.log('CUSTOM FIELDS:', fields.length);

    const labelFields = fields.filter(field => ['String', 'Integer', 'Checkbox', 'Dropdown'].includes(FIELD_TYPES[field.type_id]));

    // maybe we already imported labels
    const prevLabels = {}
    const testomatioLabels = await fetchFromTestomatio(postLabelEndpoint);
    testomatioLabels?.data?.forEach(l => {
      prevLabels[l.attributes.title] = l.id;
    });

    for (const field of labelFields) {
      logData(field);
      const label = { title: field.label, scope: ['tests', 'suites'] };
      if (FIELD_TYPES[field.type_id] === 'String' || FIELD_TYPES[field.type_id] === 'Integer') {
        label.field = {
          type: 'string',        
        }
      }

      if (FIELD_TYPES[field.type_id] === 'Dropdown') {
        let value = field.configs[0]?.options?.items;
        logData('List values', value);

        if (!value) continue;

        labelValuesMap[field.system_name] = value.split('\n').map(v => v.split(','));

        // remove numbers from values
        value = value.split('\n')
          // remove value numbers
          .map(v => v.replace(/^\d+[:\s,]/g, ''))
          .map(v => v.trim())
          .filter(v => !!v)
          .join('\n')
          .replace(/[,:]/g, ' ');

        label.field = {
          type: 'list',
          value,
        }
      }

      // already created label
      if (prevLabels[label.title]) {
        labelsMap[field.system_name] = prevLabels[label.title];
        continue;
      }

      const labelData = await postToTestomatio(postLabelEndpoint, 'label', label)

      if (!labelData) continue;

      labelsMap[field.system_name] = labelData.id;
    }
    
    logData('Field Values', labelValuesMap);

    const customFields = fields.reduce((acc, obj) => {
      acc[obj.system_name] = obj;
      return acc;
    }, {});

    logData('customFields', customFields);
    
    // Get suites for the project
    let suites = [];
    if (suiteId) {
      suites = await fetchFromTestRail(getSuiteEndpoint + suiteId);
    } else {
      suites = await fetchFromTestRail(getSuitesEndpoint);
    }

    for (const suite of suites) {

      const suiteData = { 
        title: suite.name, 
        'file-type': 'folder', 
        description: suite.description 
      };

      const testomatioSuite = await postToTestomatio(postSuiteEndpoint, 'suites', suiteData);
      
      const sectionsMap = {};
      const foldersIds = [];
      const filesMap = {}; 

      const sections = await fetchFromTestRail(`${getSectionsEndpoint}&suite_id=${suite.id}`, 'sections')

      console.log('SECTIONS:', sections.length);
      // should load sections without pagination
      for (const section of sections) {

        process.stdout.write('.');
        
        const parentId = sectionsMap[section.parent_id];

        const sectionData = { 
          title: section.name, 
          description: section.description,
          position: section.display_order,
          'parent-id': parentId ?? testomatioSuite?.id,
        };

        if (parentId) {
          foldersIds.push(parentId);
          await putToTestomatio(postSuiteEndpoint, 'suites', parentId, { 'file-type': 'folder' });
        }

        const postSectionResponse = await postToTestomatio(postSuiteEndpoint, 'suites', sectionData);
        
        sectionsMap[section.id] = postSectionResponse?.id;
      }
      console.log();

      const testCases = await fetchFromTestRail(`${getCasesEndpoint}&suite_id=${suite.id}`, 'cases');

      console.log('CASES:', testCases.length);

      for (const testCase of testCases) {

        process.stdout.write('.');

        const caseCustomFieldNames = Object.keys(testCase).filter(key => key.startsWith('custom_'));

        const descriptionParts = [];

        for (const fieldName of caseCustomFieldNames) {
          descriptionParts.push(await fetchDescriptionFromTestCase(testCase, customFields[fieldName]));
        }

        let description = descriptionParts.filter(d => !!d).map(d => d.trim()).join('\n\n---\n\n');

        description = formatCodeBlocks(description);

        logData('description', descriptionParts);

        // select corresponding suite
        let suiteId = sectionsMap[testCase.section_id];

        // this suite was created as a file type suite
        if (filesMap[suiteId]) suiteId = filesMap[suiteId];

        // this suite was created as a folder type suite,
        // we need to create a file type instead
        if (foldersIds.includes(suiteId)) {

          // we need to create another file type suite
          const title = sections.find(s => s.id === testCase.section_id)?.name || "Tests";
          const suiteData = { 
            title,
            'file-type': 'file', 
            'parent-id': suiteId,
            position: 1,
            description: sections.find(s => s.id === suiteId)?.description 
          };
          const newSuite = await postToTestomatio(postSuiteEndpoint, 'suites', suiteData);
          filesMap[suiteId] = newSuite.id;
          suiteId = newSuite.id;
        }

        const caseData = {
          title: testCase.title,
          priority: priorities[testCase.priority_id] || 0,
          description,
          position: testCase.display_order,
          'suite-id': suiteId,
        };

        const test = await postToTestomatio(postTestEndpoint, 'tests', caseData);

        if (!test) continue;

        // cross link to testrail
        await postToTestomatio(postIssueLinkEndpoint, null, {
          test_id: test.id,
          url: `${getTestRailUrl()}/cases/view/${testCase.id}`,
        });

        const attachments = await fetchFromTestRail(`${getAttachmentsEndpoint}${testCase.id}`, 'attachments');
        logData('attachments', attachments);

        for (const attachment of attachments) {
          const file = await downloadFile(downloadAttachmentEndpoint + attachment.id);    

          const url = await uploadFile(test.id, file, attachment);

          if (!url) continue;

          if (attachment.is_image) {
            description = description.replaceAll(`(index.php?/attachments/get/${attachment.id})`, `(${url})`)
          } else {
            description = description.replaceAll(`![](index.php?/attachments/get/${attachment.id})`, `[📎 ${attachment.name}](${url})`)
          }
          // if we have old links left, replace them with new ones
          description = description.replaceAll(`index.php?/attachments/get/${attachment.id}`, url);


          logData('description', description);
        }

        const otherAttachmentIds = description.matchAll(/index\.php\?\/attachments\/get\/(\d+)/g).map(m => m[1]);

        for (const attachmentId of otherAttachmentIds) {
          const file = await downloadFile(downloadAttachmentEndpoint + attachmentId);    

          const url = await uploadFile(test.id, file, { id: attachmentId });

          if (!url) continue;

          description = description.replaceAll(`index.php?/attachments/get/${attachmentId}`, url);
        }

        await putToTestomatio(postTestEndpoint, 'tests', test.id, { description });      

        // refs
        const refs = testCase.refs?.split(',').map(ref => ref.trim()).filter(ref => !!ref);

        if (refs?.length) {
          logData('refs', refs);
          for (const ref of refs) {
            try {
              if (ref.startsWith('https://')) {
                await postToTestomatio(postIssueLinkEndpoint, null, {
                  test_id: test.id,
                  url: ref,
                });
                continue;
              }
              await postToTestomatio(`${postJiraIssueEndpoint}?test_id=${test.id}&jira_id=${ref}`);
            } catch (error) {
              console.error('Error adding ref:', error);
            }
          }
        }                             

        // labels
        const labels = Object.keys(testCase).filter(key => key.startsWith('custom_') && labelsMap[key]);
        for (const label of labels) {
          const numValue = testCase[label];
          if (numValue === null || numValue === undefined) continue;

          let value = numValue;

          labelValuesMap[label]?.forEach(m => {
            if (m[0] == numValue.toString()) value = m[1].trim();
          });

          try {
            await postToTestomatio(postLabelLinkEndpoint.replace(':lid', labelsMap[label]), null, {
              test_id: test.id,
              event: 'add',
              value,
            });
          } catch (error) {
            console.error('Error adding label:', error);
          }
        }
      }
    }
    console.log('Done');
  } catch (error) {
    console.error('Error:', error);
  }
}

function fetchDescriptionFromTestCase(testCase, field) {

  if (FIELD_TYPES[field.type_id] === 'Text') {
    const text = testCase[field.system_name] || '';
    if (!text) return '';
    return `## ${field.label}\n\n${text.trim()}`;
  }

  if (FIELD_TYPES[field.type_id] === 'URL') {
    const text = testCase[field.system_name].trim() || '';
    if (!text) return '';
    return `[${field.label}](${text})`;
  }

  if (FIELD_TYPES[field.type_id] === 'Steps') {
    const text = testCase[field.system_name]?.map(step => {
      let res = step.content?.trim();
      if (!res) return '';
      if (!res.startsWith('- ')) res = '- ' + res;
      if (step.expected) {
        if (!step.expected.trim()) return "\n" + res;

        res += '\n*Expected*: ' + step.expected.split('\n')     
          .map(line => line.trim())
          .filter(line => !!line)
          .map(line => {
            if (line.startsWith('- ')) line = line.slice(2).trim();
            return line;
          })
          .join('\n').trim();
      }

      return '\n' + res;      
    })?.join('\n');

    if (!text) return '';
    return `## ${field.label}\n\n${text.trim()}`;
  }
}

function formatCodeBlocks(description) {

  return description
    .split('\n')
    .map(line => {
      // if it looks like HTML tag, wrap it in code block
      if (line.trim().match(/^<\w+/)) {
        return '`' + line.trim() + '`';
      }            
      // todo: add more checks for code blocks
      return line;
    })
    .join('\n')
    .replace(/(<[^>]+>)/g, '`$1`');
}

function convertPriorities(priorities) {
  const convertedPriorities = {}
  
  const defaultIndex = priorities.find(p => p.short_name == 'Medium' || p.is_default)?.priority || 0;

  priorities.forEach((priority) => {
    const index = priority.priority;

    let value = 0;
    
    if (index < defaultIndex) {
      value = -1;
    } else if (index > defaultIndex) {
      value = Math.min(index - defaultIndex, 3);
    }
    convertedPriorities[priority.id] = value;
  });

  return convertedPriorities;
}
