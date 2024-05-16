import 'dotenv/config'
import migrateTestCases from './migrate.js';
import { configureTestRail } from './testrail.js';
import { configureTestomatio } from './testomatio.js';

// ENABLE THIS LINE TO RUN THE SCRIPT
// PASS VALID VARIABLES TO ACCESS TESTRAIL
// configureTestRail(testrailBaseUrl, username, password, projectId);
configureTestRail(
  process.env.TESTRAIL_URL,
  process.env.TESTRAIL_USERNAME, 
  process.env.TESTRAIL_PASSWORD, 
  process.env.TESTRAIL_PROJECT_ID
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
