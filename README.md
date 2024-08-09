# XRay ➡ Testomat.io Migration Script

This script migrates test cases from TestRail to [Testomat.io](https://testomat.io) via API.

You are free to customize this script if the default behavior doesn't fit your needs.

## Set Up Locally

* Ensure **NodeJS 20+** is installed
* Clone this repository
* Copy `.env.example` to `.env`

```
cp .env.example .env
```

* Fill in TestRail and Testomat.io credentials into `.env` file
* Install dependencies

```
npm i
```

* Run script

```
npm start
```

## Troubleshooting

#### Authentication request has expired. Try reloading the page

If you see error like this:

```
Error fetching data: Error: Failed to fetch data: /test-repository: 401 Unauthorized
{"error":"Authentication request has expired. Try reloading the page."}
```

Try to open XRay app and fetch a new token and run script again.



## Debugging

To enable more verbose output you can add debug flags via `DEBUG=` environment variable:

* `DEBUG="testomatio:testrail:in"` - print all data coming from TestRail
* `DEBUG="testomatio:testrail:out"` - print all data posting to Testomat.io
* `DEBUG="testomatio:testrail:migrate"` - print all data processing
* `DEBUG="testomatio:testrail:*"` - print all debug information

```
DEBUG="testomatio:testrail:*" npm start
```

## Customization

We keep this repository public, so you could customize the data you import.

Update `migrate.js` script to customize how sections, suites, and cases are obtained. You can customize the way how steps are transformed or test descriptions.

Update the following file and run the script.

## License

MIT