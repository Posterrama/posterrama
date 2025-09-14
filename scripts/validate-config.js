#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const Ajv = require('ajv');

function loadJson(file) {
    const full = path.resolve(__dirname, '..', file);
    const txt = fs.readFileSync(full, 'utf8');
    return JSON.parse(txt);
}

function validateConfig(name, schema, data) {
    const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
    const validate = ajv.compile(schema);
    const valid = validate(data);
    if (valid) {
        console.log(`PASS: ${name} is valid`);
        return true;
    }
    console.error(`FAIL: ${name} is invalid`);
    console.error(JSON.stringify(validate.errors, null, 2));
    return false;
}

try {
    const schema = loadJson('config.schema.json');
    const config = loadJson('config.json');
    const example = loadJson('config.example.json');

    const ok1 = validateConfig('config.json', schema, config);
    const ok2 = validateConfig('config.example.json', schema, example);

    if (!ok1 || !ok2) process.exit(1);
} catch (err) {
    console.error('Validation failed with an exception:', err);
    process.exit(2);
}
