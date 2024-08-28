import fs from 'fs';
import debug from 'debug';

const logOutput = debug('testomatio:xray:out');

// disable all save requests
const DRY_RUN = !!process.env.DRY_RUN;

let token;
let host;
let project;

let jwtToken;

// for rate limit
let attempt = 0;

export function getTestomatioEndpoints() {
  return {
    postSuiteEndpoint: `/api/${project}/suites`,
    postTestEndpoint: `/api/${project}/tests`,
    postAttachmentEndpoint: `/api/${project}/tests/:tid/attachment`,
    postIssueLinkEndpoint: `/api/${project}/ims/issues/link`,
    postJiraIssueEndpoint: `/api/${project}/jira/issues`,
    postLabelEndpoint: `/api/${project}/labels`,
    postExampleEndpoint: `/api/${project}/examples`,
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

  const maxAttempts = 3;
  let response;
  logOutput('AccessToken', jwtToken);

  const requestData = type
    ? JSON.stringify({ data: { attributes: data, type } })
    : JSON.stringify(data);

  const requestUrl = `${host}${endpoint}`;

  try {
    logOutput('postToTestomatio', requestUrl, requestData);

    response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': jwtToken,
      },
      body: requestData,
    });

    if (response.status === 429) {
      if (attempt < maxAttempts) {
        attempt++;
        console.log(`Rate limit hit. Waiting for 1 minute before retrying... (Attempt ${attempt})`);
        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait for 1 minute
        return postToTestomatio(endpoint, type, data); // Retry after waiting
      } else {
        throw new Error('Max retry attempts reached. Halting.');
      }
    }

    if (!response.ok) {
      throw new Error(`Failed to send data: ${response.status} ${response.statusText} ${await response.text()}`);
    }

  } catch (error) {
    console.error('Error:', error);
    return;
  }

  const json = await response.json();
  logOutput('postToTestomatio:response', json);

  attempt = 0; // Reset attempts after successful request
  return json.data;
}

export async function putToTestomatio(endpoint, type, id, data) {
  if (DRY_RUN) return;

  const maxAttempts = 3;
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

    if (response.status === 429) {
      if (attempt < maxAttempts) {
        console.log(`Rate limit hit. Waiting for 1 minute before retrying... (Attempt ${attempt})`);
        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait for 1 minute
        attempt++;
        return putToTestomatio(endpoint, type, id, data); // Retry with incremented attempt count
      } else {
        throw new Error('Max retry attempts reached. Halting.');
      }
    }

    if (!response.ok) {
      throw new Error(`Failed to send data: ${response.status} ${response.statusText} ${await response.text()}`);
    }

  } catch (error) {
    console.error('Error:', error);
    return;
  }
  attempt = 0;
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
