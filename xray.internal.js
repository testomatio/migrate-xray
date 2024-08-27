import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { fetchFromJira, getJiraEndpoints } from './jira.js';
import debug from 'debug';

const logInput = debug('testomatio:xray:in');

let xrayToken;
let xrayEndpoint = 'https://eu.xray.cloud.getxray.app/api/internal';
let jiraProjctId;

export function configureXRay(xAcptToken, endpoint = null) {
  if (!xAcptToken) {
    throw new Error('Missing required XRay configuration');
  }

  xrayToken = xAcptToken;
  if (endpoint) xrayEndpoint = endpoint;
}

export async function fetchFromXRay(url, method = 'GET', body = {}) {

  if (!jiraProjctId) {
    const jiraProjects = await fetchFromJira(getJiraEndpoints().getProjectEndpoint);
    if (!jiraProjects || !jiraProjects.length) {
      throw new Error('Failed to fetch Jira Project ID');
    }
    jiraProjctId = jiraProjects[0].id;
  }

  body.projectId = jiraProjctId;

  if (method === 'GET') body = null;

  logInput('Fetching data from XRay:', `${xrayEndpoint}${url}`, body);

  try {
    const response = await fetch(`${xrayEndpoint}${url}`, {
      body: body ? JSON.stringify(body) : null,
      method,
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json;charset=UTF-8",
        "x-acpt": xrayToken,
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${url}: ${response.status} ${response.statusText}\n${await response.text()}`);
    }

    const data = await response.json();
    logInput('Fetched data from:', url.toString(), data);

    return data;

  } catch (error) {
    console.error('Error fetching data:', error);
    throw error;
  }
}

export async function fetchRepository() {
  const url = `/test-repository`;
  return fetchFromXRay(url, 'POST');
}

export async function fetchTestsFromFolder(folderId) {
  const url = `/test-repository/get-tests`;
  return fetchFromXRay(url, 'POST', {folderIds: [folderId]});
}

export async function fetchSteps(testId) {

  const steps = await fetchFromXRay(`/test/${testId}/steps?startAt=0&maxResults=99`, 'GET');

  return steps.steps;
}

export async function fetchPreconditions(testId) {

  const preconditions = await fetchFromXRay(`/issuelinks/test/${testId}/preconditions`, 'GET');

  return preconditions.map(p => p.id);
}

export async function downloadAttachment(attachment) {
  const attachmentId = attachment.id;
  const url = `/attachments/${attachmentId}`;

  const response = await fetch(`${xrayEndpoint}${url}?jwt=${xrayToken}`, {
    method: 'GET',
  });

  const buffer = await response.arrayBuffer();
  const filePath = path.join(tmpdir(), 'xray-attach-' + attachment.id +  attachment.filename);

  fs.writeFileSync(filePath, Buffer.from(buffer));

  return filePath;
}

export async function fetchParams(testId) {
  const paramDataset = await fetchFromXRay(`/paramDataset?testIssueId=${testId}`, 'GET');

  if (!paramDataset) return;

  const params = paramDataset.parameters

  if (!params.length) return;

  return params.map(p => p.name);
}

export async function fetchExamples(testId) {
  const endpointUrl = new URL(xrayEndpoint);

  const testVersionId = await fetchVsersionId(testId);

  const url = `${endpointUrl.protocol}//${endpointUrl.host}/view/dialog/param-dataset-dialog?testIssueId=${testId}&testVersionId=${testVersionId}&jwt=${xrayToken}`;

  console.log(url)

  const resp = await fetch(url, {
    method: 'GET',
    "accept": "text/html",
  })

  const html = await resp.text();

  console.log(html);

  const rows = getDataFromHtml(html, 'dataset-rows');

  return rows;
}


async function getDataFromHtml(html, id) {
  try {
    // Load the HTML content into cheerio
    const $ = cheerio.load(html);

    // Find the input element with the specified id
    const element = $(`#${id}`);

    if (element.length === 0) {
      throw new Error(`Could not find element with id="${id}"`);
    }

    // Get the value attribute and parse it as JSON
    const jsonData = JSON.parse(element.val());

    return jsonData;
  } catch (error) {
    console.error('Error parsing the HTML or JSON:', error);
    return null;
  }
}

export async function fetchVsersionId(testId) {
  const versions = await fetchFromXRay(`/tests/versions`, 'POST', {
    issueIds: [testId],
    includeArchived: true,
  });

  const version = Object.values(versions)[0];

  if (!version) return;

  return version[0]?.testVersionId;
}
