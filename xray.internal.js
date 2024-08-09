import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { fetchFromJira, getJiraEndpoints } from './jira.js';
import debug from 'debug';

const logInput = debug('testomatio:in:xray:in');

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

// export async function fetchVsersionId(testId) {
//   const versions = await fetchFromXRay(`/tests/versions`, 'POST', {
//     issueIds: [testId],
//     includeArchived: true,
//   });

//   const version = Object.values(versions)[0];

//   if (!version) return;

//   return version[0]?.testVersionId;
// }
