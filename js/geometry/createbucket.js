'use strict';

module.exports = createBucket;

var LineBucket = require('./linebucket.js');
var FillBucket = require('./fillbucket.js');
var PointBucket = require('./pointbucket.js');
var TextBucket = require('./textbucket.js');

function createBucket(info, placement, indices, buffers) {
    if (info.type === 'line') {
        return new LineBucket(info, buffers, placement, indices);
    } else if (info.type === 'fill') {
        return new FillBucket(info, buffers, placement, indices);
    } else if (info.type === 'icon') {
        return new PointBucket(info, buffers, placement, indices);
    } else if (info.type === 'text') {
        return new TextBucket(info, buffers, placement, indices);
    } else {
        console.warn('unknown bucket type');
    }
}