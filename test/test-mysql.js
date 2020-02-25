const md = require("../src/master-data")

const express = require('express')
const bodyParser = require('body-parser')
const app = express()
const db = require('./db-mysql')
db.connect()
const masterData = new md(db,"./config/master");
app.use(bodyParser.urlencoded({ extended: false }))
app.get('/', (req, res) => {
    console.log(req.body)
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