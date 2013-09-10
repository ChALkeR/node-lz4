var lz4_static = require('./static')
var lz4_binding = require('../build/Release/lz4')
var utils = require('./lz4stream_utils')

// Constants
var ARCHIVE_MAGICNUMBER = 0x184D2204
var EOS = 0
var LZ4STREAM_VERSION = 1

// n/a, n/a, n/a, n/a, 64KB, 256KB, 1MB, 4MB
var blockMaxSizes = [ null, null, null, null, 64<<10, 256<<10, 1<<20, 4<<20 ]

function decodeError (offset, msg) {
	throw new Error( (msg || 'Invalid data') + ' at ' + offset )
}

function LZ4_uncompress (input) {
	var pos = 0
	var currentStreamChecksum = null

	//TODO support skippable chunks

	// Magic number check
	if (input.length < 4
	|| input.readUInt32LE(0, true) !== ARCHIVE_MAGICNUMBER )
		decodeError(0, 'Invalid magic number')
	pos += 4

	// Stream descriptor 
	// version
	if ( input.length - pos < 2 ) decodeError(pos, 'Invalid version')
	var descriptor_flg = input.readUInt8(pos, true)
	var version = descriptor_flg >> 6
	if ( version !== LZ4STREAM_VERSION )
		throw new Error('Invalid version: ' + version + ' != ' + LZ4STREAM_VERSION)

	// flags
	// reserved bit should not be set
	if ( descriptor_flg >> 1 & 0x1 ) decodeError(pos, 'Reserved bit set')

	var options = {
		blockIndependence: Boolean( (descriptor_flg >> 5) & 0x1 )
	,	blockChecksum: Boolean( (descriptor_flg >> 4) & 0x1 )
	,	blockMaxSize: blockMaxSizes[ (input.readUInt8(pos+1, true) >> 4) & 0x7 ]
	,	streamSize: Boolean( (descriptor_flg >> 3) & 0x1 )
	,	streamChecksum: Boolean( (descriptor_flg >> 2) & 0x1 )
	,	dict: Boolean( descriptor_flg & 0x1 )
	,	dictId: 0
	}
	pos += 2
console.log(options)

	// Stream size
	var streamSize
	if (options.streamSize) {
 		if ( input.length - pos < 8 ) decodeError(pos, 'Invalid stream size')
 		//TODO max size is unsigned 64 bits
		streamSize = input.slice(pos, pos + 8)
		pos += 8
	}

	// Dictionary id
	var dictId
	if (options.dictId) {
 		if ( input.length - pos < 4 ) decodeError(pos, 'Invalid dictionary id')
 		dictId = input.readUInt32LE(pos, false)
 		pos += 4
	}

	// Stream descriptor checksum
	if ( input.length - pos < 1 ) decodeError(pos, 'Missing stream descriptor checksum')
	var checksum = input.readUInt8(pos, true)
	var currentChecksum = utils.descriptorChecksum( input.slice(4, pos) )
	if (currentChecksum !== checksum) decodeError(pos, 'Invalid stream descriptor checksum')
	pos++

	// Data blocks
	var output = []

	while ( pos < input.length && input.readUInt32LE(pos, false) !== EOS ) {
		// block size
		if ( input.length - pos < 4 ) decodeError(pos, 'Missing block size')
		var blockSize = input.readUInt32LE(pos, false)
		var size = (blockSize << 1) >> 1
		// var size = blockSize & 0x7FFF
	console.log('size', size)
		pos += 4
		var block = input.slice(pos, pos + size)

		pos += size
		if (options.blockChecksum) {
			if ( input.length - pos < 4 ) decodeError(pos, 'Missing block checksum')
			var checksum = input.readUInt32LE(pos, false)
			var currentChecksum = utils.blockChecksum( block )
			if (currentChecksum !== checksum) decodeError(pos, 'Invalid block checksum')
			pos += 4
		}

		var uncompressed
		// uncompressed?
		if ( blockSize >> 31 ) {
	console.log('uncompressed')
			uncompressed = block
		} else {
	console.log('compressed')
			uncompressed = new Buffer(options.blockMaxSize)
			var decodedSize = lz4_binding.uncompress( block, uncompressed )
			if (decodedSize < 0) decodeError(-decodedSize)
			if ( decodedSize < options.blockMaxSize ) uncompressed = uncompressed.slice(0, decodedSize)
		}
		output.push( uncompressed )

		// Stream checksum
		if (options.streamChecksum) {
			currentStreamChecksum = utils.streamChecksum(uncompressed, currentStreamChecksum)
		}
	}
	// EOS
	if ( input.length - pos < 4 ) decodeError(pos, 'Missing end of stream')
	pos += 4
	
	// Stream checksum
	if (options.streamChecksum) {
		if ( input.length - pos < 4 ) decodeError(pos, 'Missing stream checksum')
		var checksum = input.readUInt32LE(pos, false)
		if ( checksum !== utils.streamChecksum(null, currentStreamChecksum) )
			decodeError(pos, 'Invalid stream checksum')
		pos += 4
	}

	//TODO support concatenated lz4 streams

	return Buffer.concat(output)
}

exports.LZ4_uncompress = LZ4_uncompress
