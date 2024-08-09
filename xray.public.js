import debug from 'debug';

const logInput = debug('testomatio:xray:in');

let clientId;
let clientSecret;
let xrayToken;
let xrayTokenExpiration;


const XRAY_API_BASE_URL = 'https://xray.cloud.getxray.app/api/v2';
const XRAY_GRAPHQL_URL = 'https://xray.cloud.getxray.app/api/v2/graphql';


export function configureXRay(xrayClientId, xrayClientSecret) {

  if (!xrayClientId || !xrayClientSecret) {
    throw new Error('Missing required XRay configuration');
  }

  clientId = xrayClientId;
  clientSecret = xrayClientSecret;
}

export function getXRayEndpoints() {
  return {
    getTestRepositories: `/projects/${projectId}/test-repository`    
  }
}

// APIs not avalible on XRay Cloud:

export async function fetchFromXRay(endpoint, method = 'GET', body = null) {
  const token = await getXRayToken();

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  logInput('Fetching data from XRay:', `${XRAY_API_BASE_URL}${endpoint}`);

  const response = await fetch(`${XRAY_API_BASE_URL}${endpoint}`, options);

  if (!response.ok) {
    throw new Error(`XRay API request failed: ${response.statusText}`);
  }

  return response.json();
}

async function getXRayToken() {
  if (xrayToken && xrayTokenExpiration > Date.now()) {
    return xrayToken;
  }

  const response = await fetch(`${XRAY_API_BASE_URL}/authenticate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to authenticate with XRay API: ${response.statusText}`);
  }

  xrayToken = await response.text();

  logInput('Fetched XRay token:', xrayToken);
  // Set token expiration to 50 minutes (XRay tokens typically last for 1 hour)
  xrayTokenExpiration = Date.now() + 50 * 60 * 1000;

  return xrayToken;
}

export async function fetchFromXRayGraphQL(query, variables = {}) {
  const token = await getXRayToken();

  const response = await fetch(XRAY_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      variables
    })
  });

  logInput('GraphQL query:', query);

  if (!response.ok) {
    logInput('GraphQL response:', response);
    throw new Error(`XRay GraphQL request failed: ${response.statusText}`);
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(`GraphQL Errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

export async function fetchFolder(folderId = null) {
  const query = `
    query GetFolder($projectKey: String!, $folderId: String) {
      getFolder(projectKey: $projectKey, folderId: $folderId) {
        id
        name
        path
        folders {
          id
          name
        }
        tests {
          id
          key
          name
        }
      }
    }
  `;

  const variables = {
    projectKey: projectId,
    folderId
  };

  try {
    const data = await fetchFromXRayGraphQL(query, variables);
    return data.getFolder;
  } catch (error) {
    console.error('Error fetching folder structure:', error);
    throw error;
  }
}


