import 'dotenv/config'
import migrateTestCases from './migrate.js';
import { configureJira } from './jira.js';
import { configureXRay } from './xray.internal.js';
import { configureTestomatio } from './testomatio.js';

// ENABLE THIS LINE TO RUN THE SCRIPT
// PASS VALID VARIABLES TO ACCESS XRAY
configureJira(
  process.env.JIRA_URL,
  process.env.JIRA_USERNAME,
  process.env.JIRA_TOKEN,
  process.env.JIRA_PROJECT_ID
);

configureXRay(
  process.env.XRAY_URL,
  process.env.XRAY_INTERNAL_TOKEN,
);

// ENABLE THIS LINE TO RUN THE SCRIPT
// PASS VALID VARIABLES TO ACCESS TESTOMATIO
// configureTestomatio(testomatioAccessToken, testomatioHost, testomatioProject);
configureTestomatio(
  process.env.TESTOMATIO_TOKEN,
  process.env.TESTOMATIO_HOST || 'https://app.testomat.io',
  process.env.TESTOMATIO_PROJECT,
);

await migrateTestCases();
