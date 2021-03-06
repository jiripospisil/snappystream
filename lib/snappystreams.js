// Generated by CoffeeScript 1.10.0
var CHUNKS, MAX_FRAME_DATA_SIZE, STREAM_IDENTIFIER, SnappyStream, UnsnappyStream, async, checksumMask, crc32, i, int24, j, results, results1, snappy, stream, util,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

async = require('async');

snappy = require('snappy');

crc32 = require('sse4_crc32');

int24 = require('int24');

stream = require('stream');

util = require('util');

CHUNKS = {
  streamIdentifier: 0xff,
  compressedData: 0x00,
  uncompressedData: 0x01,
  padding: 0xfe,
  unskippable: (function() {
    results = [];
    for (i = 0x02; i <= 127; i++){ results.push(i); }
    return results;
  }).apply(this),
  skippable: (function() {
    results1 = [];
    for (j = 0x80; j <= 253; j++){ results1.push(j); }
    return results1;
  }).apply(this)
};

STREAM_IDENTIFIER = new Buffer([0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x59]);

MAX_FRAME_DATA_SIZE = 65536;

checksumMask = function(data) {
  var crc32Checksum;
  crc32Checksum = crc32.calculate(data);
  return ((crc32Checksum >> 15) | (crc32Checksum << 17)) + 0xa282ead8;
};

SnappyStream = (function(superClass) {
  extend(SnappyStream, superClass);

  function SnappyStream(options) {
    SnappyStream.__super__.constructor.call(this, options);
    this.push(STREAM_IDENTIFIER);
  }

  SnappyStream.prototype._transform = function(data, encoding, callback) {
    var dataChunks, end, offset, out, start;
    out = new Buffer(data);
    dataChunks = (function() {
      var k, ref, results2;
      results2 = [];
      for (offset = k = 0, ref = out.length / MAX_FRAME_DATA_SIZE; 0 <= ref ? k <= ref : k >= ref; offset = 0 <= ref ? ++k : --k) {
        start = offset * MAX_FRAME_DATA_SIZE;
        end = start + MAX_FRAME_DATA_SIZE;
        results2.push(out.slice(start, end));
      }
      return results2;
    })();
    return async.map(dataChunks, snappy.compress, (function(_this) {
      return function(err, compressedDataChunks) {
        var frameChunks, frameData, frameStart, k, len;
        if (err) {
          return callback(err);
        }
        frameChunks = [];
        for (k = 0, len = compressedDataChunks.length; k < len; k++) {
          frameData = compressedDataChunks[k];
          frameStart = new Buffer(8);
          frameStart.writeUInt8(CHUNKS.compressedData, 0);
          int24.writeUInt24LE(frameStart, 1, frameData.length + 4);
          frameStart.writeUInt32LE(checksumMask(frameData), 4, true);
          frameChunks.push(frameStart);
          frameChunks.push(frameData);
        }
        _this.push(Buffer.concat(frameChunks));
        return callback();
      };
    })(this));
  };

  return SnappyStream;

})(stream.Transform);

UnsnappyStream = (function(superClass) {
  extend(UnsnappyStream, superClass);

  function UnsnappyStream(verifyChecksums, options) {
    this.verifyChecksums = verifyChecksums != null ? verifyChecksums : false;
    if (options == null) {
      options = {};
    }
    UnsnappyStream.__super__.constructor.call(this, options);
    this.identifierFound = false;
    this.frameBuffer = null;
  }

  UnsnappyStream.prototype.framePayload = function(data) {
    var frameLength, mask, payload;
    frameLength = int24.readUInt24LE(data, 1);
    mask = data.readUInt32LE(4);
    payload = data.slice(8, frameLength + 4);
    if (this.verifyChecksums && checksumMask(payload) !== mask) {
      throw new Error('Frame failed checksum');
    }
    return payload;
  };

  UnsnappyStream.prototype.hasFrame = function(data) {
    return data.length > 4 && int24.readInt24LE(data, 1) + 4 <= data.length;
  };

  UnsnappyStream.prototype.toNextFrame = function(data) {
    var frameLength;
    frameLength = int24.readUInt24LE(data, 1);
    return data.slice(4 + frameLength);
  };

  UnsnappyStream.prototype.processChunks = function(chunks, done) {
    var uncompressChunk;
    uncompressChunk = function(chunk, cb) {
      if (chunk[0] === CHUNKS.uncompressedData) {
        return cb(null, chunk[1]);
      }
      return snappy.uncompress(chunk[1], cb);
    };
    return async.map(chunks, uncompressChunk, (function(_this) {
      return function(err, data) {
        if (err) {
          return _this.emit('error', err);
        }
        _this.push(Buffer.concat(data));
        return done();
      };
    })(this));
  };

  UnsnappyStream.prototype._transform = function(data, encoding, done) {
    var chunks, err, error, frameId;
    chunks = [];
    if (encoding) {
      data = new Buffer(data, encoding);
    }
    if (this.frameBuffer) {
      data = Buffer.concat([this.frameBuffer, data]);
    }
    this.frameBuffer = null;
    if (!(this.identifierFound || data.readUInt8(0) === CHUNKS.streamIdentifier)) {
      return this.emit('error', new Error('Missing snappy stream identifier'));
    }
    while (this.hasFrame(data)) {
      frameId = data.readUInt8(0);
      try {
        switch (frameId) {
          case CHUNKS.streamIdentifier:
            if (data.slice(0, 10).toString() !== STREAM_IDENTIFIER.toString()) {
              throw new Error('Invalid stream identifier');
            }
            this.identifierFound = true;
            break;
          case CHUNKS.compressedData:
            chunks.push([CHUNKS.compressedData, this.framePayload(data)]);
            break;
          case CHUNKS.uncompressedData:
            chunks.push([CHUNKS.uncompressedData, this.framePayload(data)]);
            break;
          case indexOf.call(CHUNKS.unskippable, frameId) >= 0:
            throw new Error('Encountered unskippable frame');
        }
      } catch (error) {
        err = error;
        return this.emit('error', err);
      }
      data = this.toNextFrame(data);
    }
    if (data.length) {
      this.frameBuffer = data;
    }
    if (chunks.length) {
      return this.processChunks(chunks, done);
    } else {
      return done();
    }
  };

  UnsnappyStream.prototype.flush = function(done) {
    if (this.frameBuffer.length) {
      return this.emit('error', new Error('Failed to decompress Snappy stream'));
    }
  };

  return UnsnappyStream;

})(stream.Transform);

module.exports = {
  SnappyStream: SnappyStream,
  UnsnappyStream: UnsnappyStream
};
