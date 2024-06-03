import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import debug from 'debug';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

const logInput = debug('testomatio:testrail:in');

let baseUrl;
let username;
let password;
let projectId;

export function getTestRailEndpoints() {
  return {
    getSuitesEndpoint: '/api/v2/get_suites/'+projectId, // Requires project ID
    getSectionsEndpoint: '/api/v2/get_sections/'+projectId, // Requires project ID
    getCasesEndpoint: '/api/v2/get_cases/'+projectId, // Requires project ID and suite ID
    getCaseFieldsEndpoint: '/api/v2/get_case_fields/'+projectId, // Requires project ID
    getAttachmentsEndpoint: '/api/v2/get_attachments_for_case/', // Requires test case ID
    downloadAttachmentEndpoint: '/api/v2/get_attachment/',
    getSuiteEndpoint: '/api/v2/get_suite/', // Requires suite ID
    getPrioritesEndpoint: '/api/v2/get_priorities',
  }
}

export function getTestRailUrl() {
  return baseUrl;
}

export function configureTestRail(testRailBaseUrl, testRailUsername, testRailPassword, testRailProjectId) {
  
  if (!testRailBaseUrl || !testRailUsername || !testRailPassword || !testRailProjectId) {
    throw new Error('Missing required TestRail configuration');
  }

  if (!testRailBaseUrl.endsWith('/index.php?')) { 
    testRailBaseUrl += '/index.php?';
  }  
  
  baseUrl = testRailBaseUrl;
  username = testRailUsername;
  password = testRailPassword;
  projectId = testRailProjectId;
}

export async function fetchFromTestRail(endpoint, type = null) {
  let items = [];
  
  let fetchUrl = endpoint;
  do {    
    const response = await fetch(baseUrl + fetchUrl, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(username + ":" + password),
        'Content-Type': 'application/json',
      },
    });
  
    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${baseUrl + fetchUrl}: ${response.status} ${response.statusText}\n${await response.text()}`);
    }
    const data = await response.json();
    logInput('fetchFromTestRail', `${baseUrl}${endpoint}`, data);
    if (type) items = items.concat(data[type]);
    if (!type) items = items.concat(data);

    if (data.error) {
      throw new Error(data.error);
    }
    
    // fetchUrl = null;
    fetchUrl = data?._links?.next;
  } while (fetchUrl);

  return items;
}

export async function downloadFile(url) {
  try {
    logInput(`Downloading file ${baseUrl + url}`);
    const response = await fetch(baseUrl + url, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(username + ":" + password),
      },  
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    }

    const tempFilePath = path.join(tmpdir(),`download-testrail-${url.split('/').pop()}`);
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    const fileStream = fs.createWriteStream(tempFilePath, { flags: 'wx' });
    await finished(Readable.fromWeb(response.body).pipe(fileStream));

    logInput(`File ${url} downloaded and saved to ${tempFilePath}`);
    return tempFilePath;
  } catch (error) {
    console.error('Error downloading file:', error);
  }
};
