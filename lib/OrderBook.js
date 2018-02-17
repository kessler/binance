const through2 = require('through2')
const LinkedList = require('digital-chain')
const pump = require('pump')
const EventEmitter = require('events')

const EVENTS = Object.freeze([
	'bid new price level',
	'bid remove price level',
	'ask new price level',
	'ask remove price level',
	'depth update event drop',
	'depth update event process',
	'maxBid change',
	'minAsk change'
])

/**
 *	Open a stream to wss://stream.binance.com:9443/ws/bnbbtc@depth
 *	Buffer the events you receive from the stream
 *	Get a depth snapshot from **https://www.binance.com/api/v1/depth?symbol=BNBBTC&limit=1000"
 *	Drop any event where "firstUpdateId" is <= lastUpdateId in the snapshot
 *	The first processed should have "lastUpdateId" <= lastUpdateId+1 AND "firstUpdateId" >= lastUpdateId+1
 *	While listening to the stream, each new event's lastUpdateId should be equal to the previous event's firstUpdateId+1
 *	The data in each event is the absolute quantity for a price level
 *	If the quantity is 0, remove the price level
 *	Receiving an event that removes a price level that is not in your local order book can happen and is normal.
 *    
 */
class OrderBook extends EventEmitter {
	constructor(ws, rest, symbol) {
		super()
		this._ws = ws
		this._rest = rest
		this._symbol = symbol
		this._buffer = new LinkedList()

		this._bids = new Map()
		this._bidPriceIndex = []

		this._asks = new Map()
		this._askPriceIndex = []

		this._snapshotObtained = false

		// TODO this is very inefficient
		this.on('bid new price level', (fPrice) => {
			let maxBid = this.maxBid

			this._bidPriceIndex.push(fPrice)
			this._bidPriceIndex.sort((a, b) => b - a)

			let newMaxBid = this.maxBid

			if (newMaxBid !== maxBid) {
				this._emitMaxBidChange(newMaxBid, maxBid)
			}
		})

		// TODO this is very inefficient
		this.on('bid remove price level', (fPrice) => {
			let maxBid = this.maxBid

			this._bidPriceIndex = Array.from(this._bids.keys())
			this._bidPriceIndex.sort((a, b) => b - a)

			let newMaxBid = this.maxBid

			if (newMaxBid !== maxBid) {
				this._emitMaxBidChange(newMaxBid, maxBid)
			}
		})

		// TODO this is very inefficient
		this.on('ask new price level', (fPrice) => {
			let minAsk = this.minAsk

			this._askPriceIndex.push(fPrice)
			this._askPriceIndex.sort((a, b) => a - b)

			let newMinAsk = this.minAsk

			if (newMinAsk !== minAsk) {
				this._emitMinAskChange(newMinAsk, minAsk)
			}
		})

		// TODO this is very inefficient
		this.on('ask remove price level', (fPrice) => {
			let minAsk = this.minAsk

			this._askPriceIndex = Array.from(this._asks.keys())
			this._askPriceIndex.sort((a, b) => a - b)

			let newMinAsk = this.minAsk

			if (newMinAsk !== minAsk) {
				this._emitMinAskChange(newMinAsk, minAsk)
			}
		})
	}

	get minAsk() {
		if (this._askPriceIndex.length === 0) return 0
		return this._askPriceIndex[0]
	}

	get maxBid() {
		if (this._bidPriceIndex.length === 0) return 0
		return this._bidPriceIndex[0]
	}

	get events() {
		return EVENTS
	}

	// TODO improve performance
	getAskLevelsBetween(a, b) {
		let min = Math.min(a, b)
		let max = Math.max(a, b)

		let levels = []

		for (let level of this._askPriceIndex) {
			if (level >= min && level <= max) {
				levels.push(level)
			}
		}

		return levels
	}

	getBidLevelsBetween(a, b) {
		let min = Math.min(a, b)
		let max = Math.max(a, b)
		let levels = []

		for (let level of this._bidPriceIndex) {
			if (level >= min && level <= max) {
				levels.push(level)
			}
		}

		return levels
	}

	getBidPriceLevelQuantity(bid) {
		return this._bids.get(bid)
	}

	getAskPriceLevelQuantity(ask) {
		return this._asks.get(ask)
	}

	start(stream) {
		if (!stream) {
			let csb = this._ws.combinedStreamBuilder()
			csb.addSymbol(this._symbol).depth()
			stream = csb.createObjectReadStream()
		}

		pump(
			stream,
			through2.obj((chunk, enc, cb) => this._bufferStream(chunk, enc, cb)),
			err => this.emit('error', err)
		)

		this._rest.depth({ symbol: this._symbol, limit: 1000 }, (err, result) => {
			if (err) return this.emit('error', err)

			for (let [price, quantity] of result.bids) {
				this._processBidEntry(price, quantity)
			}

			for (let [price, quantity] of result.asks) {
				this._processAskEntry(price, quantity)
			}

			this._snapshotObtained = true

			let snapshotLastUpdateId = result.lastUpdateId

			for (let [depthUpdate, node] of this._buffer) {
				if (depthUpdate.lastUpdateId <= snapshotLastUpdateId) {
					this._buffer.remove(node)
					this.emit('depth update event drop', depthUpdate)
					continue
				}

				if (depthUpdate.lastUpdateId <= snapshotLastUpdateId + 1 &&
					depthUpdate.firstUpdateId >= snapshotLastUpdateId + 1) {
					this._processDepthUpdateEvent(depthUpdate)
				} else {
					this.emit('depth update event drop', depthUpdate)
				}
			}

			this._buffer = undefined
		})
	}

	_bufferStream(chunk, enc, cb) {

		// not a depth object
		if (chunk.eventType && chunk.eventType !== 'depthUpdate') {
			return cb()
		}

		if (this._buffer) {
			if (this._buffer.length > 500) {
				this._buffer.pop()
			}

			this._buffer.unshift(chunk)
		}

		this._processDepthUpdateEvent(chunk)
		cb()
	}

	_processDepthUpdateEvent(depthUpdate) {
		if (!this._snapshotObtained) return

		if (this._recentFirstUpdateId && depthUpdate.lastUpdateId !== this._recentFirstUpdateId + 1) {
			return this.emit('depth update event drop', depthUpdate)
		}

		this._recentFirstUpdateId = depthUpdate.firstUpdateId

		for (let { price, quantity } of depthUpdate.bidDepthDelta) {
			this._processBidEntry(price, quantity)
		}

		for (let { price, quantity } of depthUpdate.askDepthDelta) {
			this._processAskEntry(price, quantity)
		}

		this.emit('depth update event process', depthUpdate)
	}

	_processBidEntry(price, quantity) {
		this._processEntry(price, quantity, this._bids, 'bid')
	}

	_processAskEntry(price, quantity) {
		this._processEntry(price, quantity, this._asks, 'ask')
	}

	_processEntry(price, quantity, target, label) {
		let fPrice = parseFloat(price)
		let fQuantity = parseFloat(quantity)

		if (isNaN(fPrice) || isNaN(fQuantity)) {
			throw new Error(`invalid price "${price}" or quantity "${quantity}"`)
		}

		let exists = target.has(fPrice)

		if (fQuantity === 0) {
			if (exists) {
				target.delete(fPrice)
				this.emit(`${label} remove price level`, fPrice, fQuantity)
			}

			return
		}

		target.set(fPrice, fQuantity)

		if (exists) {
			this.emit(`${label} update price level quantity`, fPrice, fQuantity)
		} else {
			this.emit(`${label} new price level`, fPrice, fQuantity)
		}
	}

	_emitMaxBidChange(newMaxBid, lastMaxBid) {
		this.emit('maxBid change', newMaxBid, lastMaxBid)
	}

	_emitMinAskChange(newMinAsk, lastMinAsk) {
		this.emit('minAsk change', newMinAsk, lastMinAsk)
	}
}

module.exports = OrderBook
