import fs from 'fs';
import debug from 'debug';

const logOutput = debug('testomatio:testrail:out');

// disable all save requests
const DRY_RUN = !!process.env.DRY_RUN;

let token;
let host;
let project;

let jwtToken;

export function getTestomatioEndpoints() {
  return {
    postSuiteEndpoint: `/api/${project}/suites`,
    postTestEndpoint: `/api/${project}/tests`,
    postAttachmentEndpoint: `/api/${project}/tests/:tid/attachment`,
    postIssueLinkEndpoint: `/api/${project}/ims/issues/link`,
    postJiraIssueEndpoint: `/api/${project}/jira/issues`,
    postLabelEndpoint: `/api/${project}/labels`,
    postLabelLinkEndpoint: `/api/${project}/labels/:lid/link`,
  }
}

export function configureTestomatio(
  testomatioAccessToken,
  testomatioHost,
  testomatioProject
) {
  if (!testomatioAccessToken || !testomatioHost || !testomatioProject) {
    throw new Error('Missing required Testomat.io parameters');
  }
  token = testomatioAccessToken;
  host = testomatioHost;
  project = testomatioProject;
}

export async function loginToTestomatio() {
  const response = await fetch(`${host}/api/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: "api_token=" + token,
  });

  const data = await response.json();
  logOutput('loginToTestomatio', data);
  jwtToken = data.jwt;
}

export async function fetchFromTestomatio(endpoint) {
  if (DRY_RUN) return;
  const response = await fetch(`${host}/${endpoint}`, {
    headers: {
      'Authorization': jwtToken, 
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function postToTestomatio(endpoint, type = null, data = {}) {
  if (DRY_RUN) return;
  let response;
  logOutput('AccessToken', jwtToken);

  if (!type) {
    try {
      logOutput('postToTestomatio', `${host}/${endpoint}`, JSON.stringify(data));

      response = await fetch(`${host}${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwtToken, 
        }});

      if (!response.ok) {
        throw new Error(`Failed to send data: ${response.status} ${response.statusText} ${await response.text()}`);
      }        
    } catch (error) {
      console.error('Error:', error);
    }
    return response.json();
  }  
  
  logOutput('postToTestomatio', `${host}/${endpoint}`, JSON.stringify({
    data: {
      attributes: data,
      type,
    }
  }));

  try {
    response = await fetch(`${host}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': jwtToken, 
      },
      body: JSON.stringify({
        data: {
          attributes: data,
          type,
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send data: ${response.status} ${response.statusText} ${await response.text()}`);
    }

  } catch (error) {
    console.error('Error:', error);
    return;
  }
  
  const json = await response.json();
  logOutput('postToTestomatio:response', json);
  return json.data;
}


export async function putToTestomatio(endpoint, type, id, data) {
  if (DRY_RUN) return;
  let response;
  logOutput('putToTestomatio', `${host}/${endpoint}/${id}`, JSON.stringify({
    data: {
      attributes: data,
      type,
    }
  }));

  try {
    response = await fetch(`${host}/${endpoint}/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': jwtToken, 
      },
      body: JSON.stringify({
        data: {
          attributes: data,
          type,
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send data: ${response.status} ${response.statusText} ${await response.text()}`);
    }

  } catch (error) {
    console.error('Error:', error);
    return;
  }
  
  const json = await response.json();
  return json.data;
}

export const uploadFile = async (testId, filePath, attachment) => {
  if (DRY_RUN) return;
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}, can't upload`);
    return;
  }

  try {
    const formData = new FormData();

    formData.append('file', new Blob([fs.readFileSync(filePath)]), attachment.name);
    const url = getTestomatioEndpoints().postAttachmentEndpoint.replace(':tid', testId);

    const response = await fetch(host + url, {
      method: 'POST',
      body: formData,
      headers: {
        'Authorization': jwtToken, 
      },      
    });

    if (!response.ok) {
      throw new Error(`Failed to upload file: ${response.status} ${response.statusText} ${host + url}`);
    }

    const json = await response.json();
    logOutput(`File ${filePath} uploaded to ${testId} as ${json.url}`);
    return json.url;
  } catch (error) {
    console.error('Error uploading file:', error);
  }
};
