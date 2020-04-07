const fs = require("fs");
const jwt = require('jsonwebtoken');

module.exports = class MasterData {
    constructor(db, configPath) {
        this.db = db
        this.config = {
            GET: {},
            POST: {},
            PUT: {},
            DELETE: {}
        };
        if (fs.existsSync(configPath)) {
            let configList = fs.readdirSync(configPath);
            for (let configFile of configList) {
                let configDetail = fs.readFileSync(configPath+"/"+configFile,"utf8");
                let configJson = JSON.parse(configDetail);
                for (let method in configJson) {
                    for (let moduleName in configJson[method]) {
                        if (this.config[method]) {
                            if (this.config[method][moduleName]) {
                                console.error("Duplicate query module '"+method+"."+moduleName+"'")
                            } else {
                                this.config[method][moduleName] = configJson[method][moduleName];
                            }
                        }
                    }
                }
            }
        } else {
            console.error(" Error: Config folder not found '"+ configPath+"'");
        }
    }
    process(event ,callback) {
        // console.log(event)
        try {
            this.body = JSON.parse(event.body);
        } catch (error) {
            this.body = event.body;
        }
        if (event.headers !== undefined) {
            this.token = event.headers.token;
        }
        this.reqParam = this.body;
        this.callback = callback;
        this.errorStack = [];
        this.resultCollection = {};
        this.method = event.httpMethod;
        this.processQueue();
    }
    processQueue() {
        this.queueQuery = [];
        let checked = false;
        if (!this.reqParam.dataList) {
            if (this.reqParam.param && this.reqParam.param.length > 0) {
                for (let paramRow of this.reqParam.param) {
                    checked = this.processDataQueueAssignNoList(checked,paramRow);
                }
            } else {
                this.processDataQueueAssignNoList(checked,this.reqParam.param);
            }
        } else {
            this.processDataQueueAssign(checked);
        }
        this.processLoopParam();
    }
    processDataQueueAssign(checked) {
        let methodSet = this.config[this.method];
        for (let methodParam of this.reqParam.dataList) {
            if (typeof (methodSet[methodParam.moduleName]) != "undefined") {
                if (methodParam.param && methodParam.param.length > 0) {
                    for (let paramRow of methodParam.param) {
                        let configData = Object.assign({},methodSet[methodParam.moduleName]);
                        configData["inputParam"] = Object.assign({},paramRow);
                        configData["offset"] = methodParam.offset;
                        configData["limit"] = methodParam.limit;

                        let hasToken = this.checkToken(configData);
                        if (hasToken && !checked) {
                            // unpackToken
                            this.isTokenPassed = this.unpackJWTData();
                            checked = true;
                        }
                        configData["hasToken"] = hasToken;
                        this.queueQuery.push(configData);
                    }
                } else {
                    let configData = methodSet[methodParam.moduleName];
                    configData["inputParam"] = methodParam.param;
                    configData["offset"] = methodParam.offset;
                    configData["limit"] = methodParam.limit;

                    let hasToken = this.checkToken(configData);
                    if (hasToken && !checked) {
                        // unpackToken
                        this.isTokenPassed = this.unpackJWTData();
                        checked = true;
                    }
                    configData["hasToken"] = hasToken;
                    this.queueQuery.push(configData);
                }
            } else {
                this.resultCollection[methodParam.moduleName] = {
                    status: "false",
                    message: "Config Not Found"
                }
            }
        }
    }
    processDataQueueAssignNoList(checked,inputParam) {
        let methodSet = this.config[this.method];
        let configData = {};
        if (!this.reqParam.moduleName) {
            if (typeof (methodSet["default"]) != "undefined") {
                configData = Object.assign({},methodSet["default"]);
            } else {
                this.resultCollection[this.reqParam.moduleName] = {
                    status: "false",
                    message: "Config Not Found"
                }
            }
        } else {
            if (typeof (methodSet[this.reqParam.moduleName]) != "undefined") {
                configData = Object.assign({},methodSet[this.reqParam.moduleName]);
            } else {
                this.resultCollection[this.reqParam.moduleName] = {
                    status: "false",
                    message: "Config Not Found"
                }
            }
        }
        configData["inputParam"] = Object.assign({},inputParam);
        configData["offset"] = this.reqParam.offset;
        configData["limit"] = this.reqParam.limit;

        let hasToken = this.checkToken(configData);
        if (hasToken && !checked) {
            // unpackToken
            this.isTokenPassed = this.unpackJWTData();
            checked = true;
        }
        configData["hasToken"] = hasToken;
        this.queueQuery.push(configData);
        return checked;
    }
    processLoopParam() {
        if (this.queueQuery.length > 0) {
            let processData = this.queueQuery.shift();
            let hasRequireToken = processData.hasToken;
            // console.log("require token module ", processData.responseName, hasRequireToken);
            if (hasRequireToken) {
                if (this.isTokenPassed) {
                    let hasRole = this.checkRole(processData);
                    if (hasRole) {
                        // console.log("has token and rules");
                        this.processQueryStatement(processData, () => {
                            this.processLoopParam();
                        });
                    } else {
                        // console.log("is not have rules");
                        this.processLoopParam();
                    }
                } else {
                    // console.log("Can not take to use token, Token Expire or Not Submitted Token");
                    this.processLoopParam();
                }
            } else {
                // console.log("No token require");
                this.processQueryStatement(processData, () => {
                    this.processLoopParam();
                });
            }

        } else {
            // console.log("done>>",this.resultCollection);
            if (this.errorStack.length === 0) {
                this.callback(null, {
                    status: true,
                    message: "",
                    data: this.resultCollection
                });
            } else {
                this.callback(null, {
                    status: false,
                    message: this.errorStack
                });
            }
        }
    }
    checkToken(processData) {
        if (processData.requireToken !== undefined) {
            if (processData.requireToken) {
                // console.log("require Token");
                return true;
            }
        }
        // console.log("No Token require");
        return false;
    }
    unpackJWTData() {
        if (this.token === undefined) {
            this.errorStack.push("Token error: Not Submitted Token");
            return false;
        }
        // console.log("Token Submitted");
        try {
            let data = jwt.decode(this.token, config.tokenSecretKey);
            let expire = data.exp * 1000;
            let currentMTime = new Date().getTime();
            if (currentMTime > expire) {
                // console.log("Expire");
                this.errorStack.push("Token error: Token Expire");
                return false;
            }
            // console.log(data);
            this.tokenData = data;
            return true;
        } catch (error) {
            this.errorStack.push("Token error: Can not unpack token");
            return false;
        }

    }
    checkRole(processData) {
        let hasRule = false;
        if (processData.requireRoles !== undefined) {
            let allowRoles = processData.requireRoles;
            if (allowRoles.length === 0) {
                this.errorStack.push("Authentication No Role Found: Authentication_Failed");
                return hasRule;
            }

            let rolesHave = this.tokenData.actionCodeList;
            // diff
            hasRule = allowRoles.filter(role => !rolesHave.includes(role)).length === 0;

            if (!hasRule) {
                this.errorStack.push("Authentication Some Role Has Not Found: Authentication_Failed");
            }
        } else {
            hasRule = true;
        }
        
        return hasRule;
        // console.log("No Role Found");
        // this.errorStack.push("Authentication No Role Found: Authentication_Failed");
        // return hasRule;
    }
    processQueryStatement(processData, callback) {
        let effectParam = [];
        let fieldRequire = [];
        let statement = processData.queryStatement;
        // console.log("aaa>>>",processData);
        let statementSplit = statement.split(" ");
        let statementType = statementSplit[0].toLocaleLowerCase();
        let paramSequent = this.getParamSequent(statement);
        let paramListIndex = processData.param;
        if (typeof (processData.param) != "undefined") {
            for (let paramList of processData.param) {
                if (paramList.require === true && typeof (processData.inputParam[paramList.paramName]) == "undefined") {
                    this.errorStack.push("Require parameter '" + paramList.paramName + "'");
                }
                if (paramList.conditionName) {
                    paramListIndex[paramList.conditionName] = paramList;
                } else {
                    paramListIndex[paramList.paramName] = paramList;
                }
            }
            for (let paramSeq of paramSequent) {
                let paramName = paramSeq.replace("#","");
                let paramList = paramListIndex[paramName];
                let search = "";
                let replace = "";
                if (processData.inputParam[paramList.paramName] != null && processData.inputParam[paramList.paramName] !== undefined && (processData.inputParam[paramList.paramName] != '' || (processData.inputParam[paramList.paramName] == "" && paramList.allowBlank))) {
                    search = "#" + paramList.paramName;
                    if (typeof (paramList.conditionName) != "undefined") {
                        search = "#" + paramList.conditionName
                    }
                    replace = paramList.fieldName + "=?";
                    if (statementType === "insert") {
                        replace = "?";
                    }
                    if (statementType === "select") {
                        let posWhere = statement.toLocaleLowerCase().indexOf("where");
                        let postParam = statement.indexOf(search);
                        if (postParam < posWhere || posWhere < 0) {
                            replace = "?";
                        }
                    }
                    if (typeof (paramList.operator) != "undefined" && statementType !== "insert") {
                        if (paramList.operator.toLocaleLowerCase() === "like" || paramList.operator.toLocaleLowerCase() === "not like") {
                            let likeString = processData.inputParam[paramList.paramName];
                            if (!likeString.match(/(^%|%$)/)) {
                                likeString = "%" + processData.inputParam[paramList.paramName] + "%"
                            }
                            replace = paramList.fieldName + " "+paramList.operator+" ?";
                            statement = statement.replace(search, replace);
                            effectParam.push(likeString);
                        } else if (paramList.operator.toLocaleLowerCase() === "in" || paramList.operator.toLocaleLowerCase() === "not in" || paramList.operator.toLocaleLowerCase() === "member of") {
                            replace = paramList.fieldName + " " + paramList.operator + "(?)";
                            statement = statement.replace(search, replace);
                            effectParam.push(processData.inputParam[paramList.paramName]);
                        } else if (paramList.operator.toLocaleLowerCase().indexOf("between") > -1 || paramList.operator.toLocaleLowerCase().indexOf("not between") > -1) {
                            let btType = "";
                            if (typeof(processData.inputParam[paramList.paramName]) === "object" && processData.inputParam[paramList.paramName].length === 2) {
                                btType = "param";
                            } else if (typeof(paramList.fieldName) === "object" && paramList.fieldName.length === 2) {
                                btType = "field"
                            }
                            if (btType !== "") {
                                if (btType === "param") {
                                    replace = paramList.fieldName + " "+paramList.operator+" ? AND ?";
                                    effectParam.push(processData.inputParam[paramList.paramName][0]);
                                    effectParam.push(processData.inputParam[paramList.paramName][1]);
                                } else if (btType === "field") {
                                    replace = " ? "+paramList.operator+" " +paramList.fieldName[0]+" AND "+paramList.fieldName[1]
                                    effectParam.push(processData.inputParam[paramList.paramName]);
                                }
                                statement = statement.replace(search, replace);
                            } else {
                                this.errorStack.push("Between parameter invalid '" + paramList.fieldName + "'");
                            }
                        } else {
                            replace = paramList.fieldName + paramList.operator + "?";
                            statement = statement.replace(search, replace);
                            effectParam.push(processData.inputParam[paramList.paramName])
                        }
                    } else {
                        statement = statement.replace(search, replace);
                        effectParam.push(processData.inputParam[paramList.paramName])
                    }
                    // statement = statement.replace(search,replace);
                    // effectParam.push(processData.inputParam[paramList.paramName])
                } else {
                    search = "#" + paramList.paramName;
                    if (typeof (paramList.conditionName) != "undefined") {
                        search = "#" + paramList.conditionName
                    }
                    replace = "1=1";
                    if (statementType === "insert") {
                        replace = null;
                    } else if (statementType === "update") {
                        let posWhere = statement.toLocaleLowerCase().indexOf("where");
                        let postParam = statement.indexOf(search);
                        if (postParam < posWhere) {
                            replace = paramList.fieldName+"="+paramList.fieldName
                        }
                    }
                    statement = statement.replace(search, replace);
                }
            }
        } else {
            statement = processData.queryStatement;
            effectParam = null;
        }
        if (typeof (processData.responseDefault) != "undefined") {
            this.resultCollection[processData.responseName] = processData.responseDefault
        }
        if (typeof (processData.offset) != "undefined" && typeof (processData.limit) != "undefined") {
            statement = statement + " LIMIT " + processData.offset + ", " + processData.limit;
        } else if (typeof (processData.limit) != "undefined") {
            statement = statement + " LIMIT " + processData.limit;
        }
        if (fieldRequire.length > 0) {
            let requireFieldListString = fieldRequire.join("', '");
            this.errorStack.push("Require field '" + requireFieldListString + "'");
            callback();
        } else {
            // this.queryStatement = statement;
            // this.effectParam = effectParam;
            this.processQuery(processData.responseName, statement, effectParam, processData.response, processData.logSql, callback);
        }
    }
    processQuery(responseModuleName, statement, effectParam, response, logSql, callback) {
        this.db.query(statement, effectParam, (err, data) => {
            if (logSql) {
                console.log(this.db.getLastQueryStatement())
            }
            if (!err) {
                let statementSplit = statement.split(" ");
                let statementType = statementSplit[0].toLocaleLowerCase();
                if (statementType === "select") {
                    let responseData = [];
                    if (response) {
                        for (let dataRow of data) {
                            // console.log(dataRow);
                            let respnseRow = {};
                            for (let responseName in response) {
                                let dataSplit = String(response[responseName]).split(":");
                                let fieldName = dataSplit[0];
                                let convertType = null;
                                if (dataSplit[1]) {
                                    convertType = dataSplit[1];
                                }
                                let fieldData = dataRow[fieldName];
                                //console.log(fieldName,fieldData);
                                if (typeof (fieldData) != "undefined") {
                                    respnseRow[responseName] = this.convertDataType(fieldName, fieldData, convertType);
                                } else {
                                    this.errorStack.push("Field not found '" + response[fieldName] + "' of module '" + responseModuleName + "'");
                                    // this.responseError();
                                }
                            }
                            responseData.push(respnseRow);
                        }
                    } else {
                        for (let dataRow of data) {
                            responseData.push(dataRow);
                        }
                    }

                    // console.log(typeof(this.resultCollection[responseName]));
                    if (typeof (this.resultCollection[responseModuleName]) != "undefined") {
                        this.resultCollection[responseModuleName] = this.resultCollection[responseModuleName].concat(responseData);
                    } else {
                        this.resultCollection[responseModuleName] = responseData;
                    }
                } else {
                    this.resultCollection[responseModuleName] = "success";
                }
            } else {
                this.errorStack.push(err);
            }
            callback()
        })
    }
    responseError(msg) {
        this.callback(null, {
            status: false,
            message: "Error: " + msg
        })
    }
    getParamSequent(statement) {
        let statementSplit = statement.split(/(,|\s|\)|\()/);
        let paramList = [];
        for (let queryStr of statementSplit) {
            if (queryStr.match(/^#/)) {
                paramList.push(queryStr);
            }
        }
        return paramList;
    }

    convertDataType(fieldName, fieldData, convertType) {
        if (convertType != null) {
            if (convertType === "STRING") {
                return String(fieldData);
            }
            if (convertType === "NUMBER") {
                return parseFloat(fieldData);
            }
            if (convertType === "BOOLEAN") {
                if (typeof (fieldData) == "boolean") {
                    return fieldData
                } else {
                    return fieldData.toLowerCase() === "t" || fieldData.toLowerCase() === "y" || fieldData.toLowerCase() === "true" || fieldData.toLowerCase() === "yes" || String(fieldData) === "1";
                }
            }
            if (convertType === "JSON") {
                try {
                    return JSON.parse(fieldData);
                } catch (e) {
                    this.errorStack.push("Can't convert type JSON: " + fieldName + ", Data: " + fieldData);
                }
            }
            if (convertType === "DATETIME") {
                return String(fieldData).replace(/[ \-.TZ:]/ig, "");
            }
        } else {
            return fieldData
        }
    }
};
