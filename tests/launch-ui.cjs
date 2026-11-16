'use strict';
const {Cloud}=require('../app/cloud');
const {fakeCloud}=require('./fake-cloud.cjs');
const backend=fakeCloud();
Cloud.prototype.request=backend.request;
globalThis.pbCloudBackend=backend;
require('../app/main');
