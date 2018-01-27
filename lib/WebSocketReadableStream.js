const { Readable } = require('stream')
const WebSocket = require('ws')
const Beautifier = require('./beautifier.js')

class WebSocketReadableStream extends Readable {
	constructor(options, wsPath) {
		options = options || { objectMode: true, emitErrors: true }
		super(options)
		this._emitErrors = options.emitErrors
		this._beautifier = new Beautifier()
		this._open = false
		this._wsPath = wsPath

		if (options.objectMode) {
			this._dispatch = this._dispatchObject
		} else {
			this._dispatch = this._dispatchString
		}
	}

	_read(size) {
		if (!this._open) {
			this._start()
		}
	}

	_destroy(err, callback) {
		this._stop()
		callback()
	}

	_dispatchString(data) {
		this._pushImpl(JSON.stringify(data) + '\n')
	}

	_dispatchObject(data) {
		this._pushImpl(data)
	}

	_pushImpl(data) {
		let proceed = this.push(data)
		if (!proceed) {
			this._stop()
		}
	}

	_start() {
		this._open = true
		this._setupWebSocket()
	}

	_stop() {
		if (!this._open) return
		if (!this._ws) return

		this._ws.close()
		this._open = false
	}

	_setupWebSocket() {
		this._ws = new WebSocket(this._wsPath)
		this._ws.on('message', json => {
			let data
			try {
				data = JSON.parse(json)
			} catch (e) {
				return this.emit('error', e, json)
			}

			if (!data) return

			this._dispatch(this._extractData(data))
		})

		this._ws.on('error', err => {
			return this.emit('error', err)
		})
	}

	_extractData(data) {
		return data
	}

	_emitError(e) {
		if (this._emitErrors) {
			this.emit('error', e)
		} else {
			console.error(e)
		}
	}
}

module.exports = WebSocketReadableStream
