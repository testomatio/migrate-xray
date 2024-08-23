import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import debug from 'debug';

const logInput = debug('testomatio:jira:in');

let baseUrl;
let username;
let token;
let projectId;

const jiraApiPrefix = '/rest/api/3';

const preConditionType = process.env.JIRA_PRECONDITION_ISSUE_TYPE || 'Pre-conditions';

export function configureJira(jiraBaseUrl, jiraUsername, jiraToken, jiraProject) {

  if (!jiraBaseUrl || !jiraUsername || !jiraToken || !jiraProject) {
    throw new Error('Missing required Jira configuration');
  }

  baseUrl = jiraBaseUrl;
  username = jiraUsername;
  token = jiraToken;
  projectId = jiraProject;
}

export function getJiraEndpoints() {
  return {
    getTestsEndpoint: `/search?jql=${encodeURIComponent(`project = ${projectId} AND issuetype = Test`)}&maxResults=1000`, // Requires project ID
    getPreconditionsEndpoint: `/search?jql=${encodeURIComponent(`project = ${projectId} AND issuetype = ${preConditionType}`)}`, // Requires project ID
    getFieldsEndpoint: '/field',
    getAttachmentEndpoint: '/attachment/content/',
    getProjectEndpoint: `/project/${projectId}`,
  }
}

export function getJiraUrl() {
  return baseUrl;
}


export async function fetchFromJira(endpoint, type = null) {
  let items = [];
  let fetchUrl = jiraApiPrefix + endpoint;

  logInput('Fetching data from Jira:', `${baseUrl}${fetchUrl}`);

  do {
    const url = new URL(fetchUrl, baseUrl);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': 'Basic ' + btoa(username + ":" + token),
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch data: ${url}: ${response.status} ${response.statusText}\n${await response.text()}`);
      }

      const data = await response.json();
      logInput('Fetched data from:', url.toString());

      if (type && data[type]) {
        items = items.concat(data[type]);
      } else if (!type) {
        items = items.concat(data);
      } else {
        logInput(`Type "${type}" not found in response data`);
      }

      if (data.error) {
        throw new Error(data.error);
      }

      // Check for next page
      fetchUrl = data?.nextPage || null;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw error;
    }
  } while (fetchUrl);

  logInput('Fetched data:', items);

  return items;
}

export async function fetchCustomFields() {
  try {
    const customFields = await fetchFromJira(getJiraEndpoints().getFieldsEndpoint);

    // Filter to only custom fields
    const onlyCustomFields = customFields.filter(field => field.custom);

    // Create a mapping of customfield_XXXXX to field name
    const customFieldMapping = {};
    onlyCustomFields.forEach(field => {
      customFieldMapping[field.id] = {
        name: field.name,
        type: field.schema?.type,
        description: field.description,
      };
    });

    return customFieldMapping;
  } catch (error) {
    console.error('Error fetching custom fields:', error);
    throw error;
  }
}

async function downloadAttachments(issueKey) {
  try {
    // Fetch attachment details
    const issue = await fetchFromJira(`/issue/${issueKey}?fields=attachment`);
    const attachments = issue[0].fields?.attachment;

    if (!attachments) {
      return {};
    }

    // Create a temporary directory
    const tempDir = fs.mkdtempSync(path.join(tmpdir(), 'jira-attachments-'));

    // Object to store filename-filepath pairs
    const fileMapping = {};

    // Download each attachment
    for (const attachment of attachments) {
      const response = await fetch(attachment.content, {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(username + ":" + token).toString('base64'),
        },
      });

      if (!response.ok) {
        console.warn(`Failed to download attachment ${attachment.filename}: ${response.statusText}`);
        continue;
      }

      const buffer = await response.arrayBuffer();
      const filePath = path.join(tempDir, attachment.filename);
      fs.writeFileSync(filePath, Buffer.from(buffer));

      fileMapping[attachment.filename] = filePath;
    }

    return fileMapping;
  } catch (error) {
    console.error('Error downloading attachments:', error);
    throw error;
  }
}

export async function fetchTestCase(issueId) {
  try {
    const issue = (await fetchFromJira(`/issue/${issueId}`))[0];

    if (!issue) return;

    const description = transformDescription(issue);

    const attachments = await downloadAttachments(issue.key);

    return {
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      type: issue.fields.issuetype?.name,
      priority: issue.fields.priority?.name,
      description,
      attachments,
    };
  } catch (error) {
    console.error('Error fetching and transforming issues:', error);
    throw error;
  }
}

export async function fetchTestCases() {
  try {
    const issues = await fetchFromJira(getJiraEndpoints().getTestsEndpoint, 'issues');

    const transformedIssues = await Promise.all(issues.map(async issue => {
      const description = transformDescription(issue);

      const attachments = await downloadAttachments(issue.key);

      return {
        id: issue.id,
        key: issue.key,
        summary: issue.fields.summary,
        priority: issue.fields.priority?.name,
        description,
        attachments,
      };
    }));

    return transformedIssues;
  } catch (error) {
    console.error('Error fetching and transforming issues:', error);
    throw error;
  }
}

function _convert(node, warnings) {
  switch (node.type) {

    case 'panel':
      const type = node.attrs.panelType;
      let emoji = '';
      switch (type) {
        case 'warning': emoji = '⚠️'; break;
        case 'success': emoji = '✅'; break;
        case 'info': emoji = 'ℹ️'; break;
        case 'note': emoji = '🗒'; break;
        case 'error': emoji = '❌'; break;
      }

      const parts = node.content.map(node => _convert(node, warnings));
      parts[0] = `${emoji} ${parts[0]}`;
      return parts.join('\n\n');
    case 'doc':
      return node.content.map(node => _convert(node, warnings)).join('\n\n');

    case 'expand':
      return `#### ${node.attrs.title}\n\n` + node.content.map(node => _convert(node, warnings)).join('\n\n');
    case 'text':
      return `${_convertMarks(node, warnings)}`;

    case 'expand':
      console.log('here panel');
    case 'nestedExpand':
    case 'paragraph':
      return node.content.map(node => _convert(node, warnings)).join('');

    case 'heading':
      return `${'#'.repeat(node.attrs.level)} ${node.content.map(node => _convert(node, warnings)).join('')}`;

    case 'hardBreak':
      return '\n';

    case 'inlineCard':
    case 'blockCard':
    case 'embedCard':
      return `[${node.attrs.url}](${node.attrs.url})`;

    case 'blockquote':
      return `> ${node.content.map(node => _convert(node, warnings)).join('\n> ')}`;

    case 'bulletList':
    case 'orderedList':
      return `${node.content.map((subNode) => {
        const converted = _convert.call(node, subNode, warnings);

        if (node.type === 'orderedList') {
          if (!node.attrs) {
            node.attrs = {
              order: 1,
            };
          }

          node.attrs.order += 1;
        }

        return converted;
      }).join('\n')}`;

    case 'listItem': {
      const order = this.attrs ? this.attrs.order || 1 : 1;
      const symbol = this.type === 'bulletList' ? '*' : `${order}.`;
      return `  ${symbol} ${node.content.map(node => _convert(node, warnings).trimEnd()).join(` `)}`;
    }

    case 'codeBlock': {
      const language = node?.attrs?.language || '';
      return `\n\`\`\`${language}\n${node.content.map(node => _convert(node, warnings)).join('\n')}\n\`\`\``;
    }

    case 'rule':
      return '\n\n---\n';

    case 'emoji':
      return node.attrs.shortName;

    case 'table':
      return node.content.map(node => _convert(node, warnings)).join('').replaceAll('|:-:', '|:---');

    case 'tableRow': {
      let output = '|';
      let thCount = 0;
      output += node.content.map((subNode) => {
        thCount += subNode.type === 'tableHeader' ? 1 : 0;
        return _convert(subNode);
      }).join('');
      output += thCount ? `\n${'|:-:'.repeat(thCount)}|\n` : '\n';
      return output;
    }

    case 'tableHeader':
      return `${node.content.map(node => _convert(node, warnings)).join('')}|`;

    case 'tableCell':
      return `${node.content.map(node => _convert(node, warnings)).join('')}|`;

    case 'mediaSingle':
      return node.content.map(node => _convert(node, warnings)).join('');

    case 'media':
      // we store alt as a file name
      return `![](${node.attrs.alt})`;

    default:
      console.log('Error parsing', node.type);
      return '';
  }

}

function _convertMarks(node, warnings) {
  if (!node.hasOwnProperty('marks') || !Array.isArray(node.marks)) {
    return node.text;
  }

  return node.marks.reduce((converted, mark) => {
    switch (mark.type) {
      case 'code':
        converted = `\`${converted}\``;
        break;

      case 'em':
        converted = `_${converted}_`;
        break;

      case 'link':
        converted = `[${converted}](${mark.attrs.href})`;
        break;

      case 'strike':
        converted = `~${converted}~`;
        break;

      case 'strong':
        converted = `**${converted}**`;
        break;

      default: // not supported
        warnings.add(mark.type);
        break;
    }

    return converted;
  }, node.text);
}

function transformDescription(issue) {
  let description = '';
  if (issue.fields.description) {
    if (typeof issue.fields.description === 'string') {
      // Old Jira markup format
      description = j2m.to_markdown(issue.fields.description);
    } else if (typeof issue.fields.description === 'object') {
      // Atlassian Document Format
      try {
        description = _convert(issue.fields.description);
      } catch (err) {
        console.error(`${issue.key}: Error converting ADF to markdown:`, err);
        console.error('Description:', issue.fields.description);
        description = null;
      }
    }
  }
  return description;
}
