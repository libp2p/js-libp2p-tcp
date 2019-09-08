'use strict'

const net = require('net')
const mafmt = require('mafmt')
const withIs = require('class-is')
const errCode = require('err-code')
const log = require('debug')('libp2p:tcp')
const toConnection = require('./socket-to-conn')
const createListener = require('./listener')
const { AbortError } = require('interface-transport')

class TCP {
  constructor ({ upgrader }) {
    this._upgrader = upgrader
  }

  async dial (ma, options) {
    const socket = await this._connect(ma, options)
    const maConn = toConnection(socket)
    log('new outbound connection %s', maConn.remoteAddr)
    const conn = await this._upgrader.upgradeOutbound(maConn)
    log('outbound connection %s upgraded', maConn.remoteAddr)
    return conn
  }

  _connect (ma, options = {}) {
    if (options.signal && options.signal.aborted) {
      throw new AbortError()
    }

    return new Promise((resolve, reject) => {
      const start = Date.now()
      const cOpts = ma.toOptions()

      log('dialing %s:%s', cOpts.host, cOpts.port)
      const rawSocket = net.connect(cOpts)

      const onError = err => {
        err.message = `connection error ${cOpts.host}:${cOpts.port}: ${err.message}`
        done(err)
      }

      const onTimeout = () => {
        log('connnection timeout %s:%s', cOpts.host, cOpts.port)
        const err = errCode(new Error(`connection timeout after ${Date.now() - start}ms`), 'ETIMEDOUT')
        // Note: this will result in onError() being called
        rawSocket.emit('error', err)
      }

      const onConnect = () => {
        log('connection opened %s:%s', cOpts.host, cOpts.port)
        done()
      }

      const onAbort = () => {
        log('connection aborted %s:%s', cOpts.host, cOpts.port)
        rawSocket.destroy()
        done(new AbortError())
      }

      const done = err => {
        rawSocket.removeListener('error', onError)
        rawSocket.removeListener('timeout', onTimeout)
        rawSocket.removeListener('connect', onConnect)
        options.signal && options.signal.removeEventListener('abort', onAbort)

        if (err) return reject(err)
        resolve(rawSocket)
      }

      rawSocket.on('error', onError)
      rawSocket.on('timeout', onTimeout)
      rawSocket.on('connect', onConnect)
      options.signal && options.signal.addEventListener('abort', onAbort)
    })
  }

  createListener (options, handler) {
    if (typeof options === 'function') {
      handler = options
      options = {}
    }
    options = options || {}
    return createListener({ handler, upgrader: this._upgrader }, options)
  }

  filter (multiaddrs) {
    multiaddrs = Array.isArray(multiaddrs) ? multiaddrs : [multiaddrs]

    return multiaddrs.filter(ma => {
      const protos = ma.protoNames()

      if (protos.includes('p2p-circuit')) {
        return false
      }

      if (protos.includes('ipfs')) {
        ma = ma.decapsulate('ipfs')
      }

      return mafmt.TCP.matches(ma)
    })
  }
}

module.exports = withIs(TCP, { className: 'TCP', symbolName: '@libp2p/js-libp2p-tcp/tcp' })
