const WebSocket = require('ws');
const Beautifier = require('./beautifier.js');
const { Readable } = require('stream')
const debug =  require('debug')('binance:ws')

class BinanceWS {

    constructor() {
        this._baseUrl = 'wss://stream.binance.com:9443'
        this._sockets = {};
        this._beautifier = new Beautifier();
        this._dataStreamInterval = -1;
    }

    _setupWebSocket(eventHandler, path) {
        if (this._sockets[path]) {
            return this._sockets[path];
        }
        path = `${this._baseUrl}/ws/${path}`;
        const ws = new WebSocket(path);
        ws.on('message', (json) => {
            const data = JSON.parse(json);
            eventHandler(this._beautifier.beautify(data, data.e + 'Event'));
        });
        return ws;
    }

    combinedStreamBuilder() {
        return new CombinedStreamBuilder()
    }

    onDepthUpdate(symbol, eventHandler) {
        const path = `${symbol.toLowerCase()}@depth`;
        return this._setupWebSocket(eventHandler, path);
    }

    onKline(symbol, interval, eventHandler) {
        const path = `${symbol.toLowerCase()}@kline_${interval}`;
        return this._setupWebSocket(eventHandler, path);
    }

    onAggTrade(symbol, eventHandler) {
        const path = `${symbol.toLowerCase()}@aggTrade`;
        return this._setupWebSocket(eventHandler, path);
    }

    onUserData(binanceRest, eventHandler, interval) {
        return binanceRest.startUserDataStream()
            .then((response) => {
                return this._setupWebSocket(eventHandler, response.listenKey);
                setInterval(() => {
                    binanceRest.keepAliveUserDataStream(response);
                }, interval || 60000);
            });
    }
}

class CombinedStream extends Readable  {
    constructor(streams, options) {
        options = options || { objectMode: true }
        super(options);
        this._beautifier = new Beautifier();
        this._streams = Array.from(streams).join('/');
        this._baseUrl = 'wss://stream.binance.com:9443';
        this._open = false;

        if (options.objectMode) {
            this._dispatch = this._dispatchObject
        } else {
            this._dispatch = this._dispatchString
        }
    }

    _read(size) {
        if (!this._open) {
            this._start();
        }
    }

    _destroy(err, callback) {
        this._stop();
        callback();
    }

    _start() {
        this._open = true
        let path = `${this._baseUrl}/stream?streams=${this._streams}`;
        debug(`CombinedStream:_start("${path}")`)
        this._ws = new WebSocket(path);
        this._ws.on('message', json => {
            let data = JSON.parse(json);
            data = data.data
            
            if (data.lastUpdateId && Array.isArray(data.bids) && Array.isArray(data.asks)) {
                data.eventType = `depth_${data.bids.length}`
                return this._dispatch(data)
            }

            let beautifiedData = this._beautifier.beautify(data, data.e + 'Event')
            this._dispatch(beautifiedData)
        });

        this._ws.on('error', err => {
            console.error(err)
        });
    }

    _dispatchString(data) {
        this._pushImpl(JSON.stringify(data)+'\n')
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

    _stop() {
        if (!this._open) return;
        if (!this._ws) return;

        this._ws.close();
        this._open = false;
    }
}

class CombinedStreamBuilder {
    constructor() {
        this._streams = new Set();
    }

    [Symbol.iterator]() {
        return this._streams[Symbol.iterator];
    }

    addSymbol(symbol) {
        debug(`CombinedStreamBuilder:addSymbol(${symbol})`)
        symbol = symbol.toLowerCase();
        return new SymbolStreamBuilder(this._streams, symbol);
    }

    createReadStream(options) {
        return new CombinedStream(this._streams, options)
    }
}

class SymbolStreamBuilder {
    constructor(streams, symbol) {
        this._symbol = symbol
        this._streams = streams
    }

    kline(interval) {
        debug(`SymbolStreamBuilder:kline(${interval})`)
        this._streams.add(`${this._symbol}@kline_${interval}`)
        return this
    }

    depth(level) {
        debug(`SymbolStreamBuilder:depth()`)
        let stream = `${this._symbol}@depth`
        if (level) stream += level
        this._streams.add(stream)
        return this
    }

    trade() {
        debug(`SymbolStreamBuilder:trade()`)
        this._streams.add(`${this._symbol}@trade`)
        return this
    }

    aggTrade() {
        debug(`SymbolStreamBuilder:aggTrade()`)
        this._streams.add(`${this._symbol}@aggTrade`)
        return this
    }
}

function toStreamPath(streams) {
    return streams.join('/')
}

module.exports = BinanceWS;
