const md = require("../src/master-data")

const express = require('express')
const bodyParser = require('body-parser')
const app = express()
const db = require('@godigit/godigit-lib').databaseManage;
db.connect({
    "dbConnect": {
        "user": "master_api",
        "password": "password",
        "connectString": "192.168.1.150:1522/orcl"
    },
    "type": "oracle",
    "secretKey": "a5!93D",
    "connectionLimit": 10,
    "useLambdaConnectionPool": false
});
const masterData = new md(db,"./config/master");
app.use(bodyParser.json({limit: '200mb'}));
app.use(bodyParser.urlencoded({limit: '200mb', extended: true}));
app.all('/', (req, res) => {
    console.log("body>>", req.body);
    let event = {
        body: req.body,
        headers: req.headers,
        path: req.path,
        httpMethod: req.method,
        queryStringParameters: req.query
    };
    masterData.process(event,(err, data) => {
        console.log(data);
        res.send(data);
    });

});

app.listen(3000, () => console.log(`Example app listening on port 3000!`))
