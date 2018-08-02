'use strict'

const multiaddr = require('multiaddr')
const Connection = require('interface-connection').Connection
const os = require('os')
const includes = require('lodash.includes')
const {createServer} = require('pull-net')
const EventEmitter = require('events').EventEmitter
const debug = require('debug')
const log = debug('libp2p:tcp:listen')

const getMultiaddr = require('./get-multiaddr')
const IPFS_CODE = 421

function noop () {}

module.exports = (handler) => {
  const listener = new EventEmitter()

  const server = createServer((stream) => {
    const addr = getMultiaddr(stream)
    if (!addr) {
      if (stream.remoteAddress === undefined || stream.remoteAddress.address === 'undefined') {
        log('connection closed before p2p connection made')
      } else {
        log('error interpreting incoming p2p connection')
      }
      return
    }

    log('new connection', addr.toString())

    stream.getObservedAddrs = (cb) => {
      cb(null, [addr])
    }

    const conn = new Connection(stream)
    handler(conn)
    listener.emit('connection', conn)
  })

  listener.emit('listening')

  listener.close = (options, callback) => {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    callback = callback || noop
    options = options || {}

    server.close((err, ...a) => {
      listener.emit('close')
      callback(err, ...a)
    })
  }

  let ipfsId
  let listeningAddr

  listener.listen = (ma, callback) => {
    listeningAddr = ma
    if (includes(ma.protoNames(), 'ipfs')) {
      ipfsId = getIpfsId(ma)
      listeningAddr = ma.decapsulate('ipfs')
    }

    const lOpts = listeningAddr.toOptions()
    log('Listening on %s %s', lOpts.port, lOpts.host)
    return server.listen(lOpts.port, lOpts.host, callback)
  }

  listener.getAddrs = (callback) => {
    const multiaddrs = []
    const address = server.address()

    if (!address) {
      return callback(new Error('Listener is not ready yet'))
    }

    // Because TCP will only return the IPv6 version
    // we need to capture from the passed multiaddr
    if (listeningAddr.toString().indexOf('ip4') !== -1) {
      let m = listeningAddr.decapsulate('tcp')
      m = m.encapsulate('/tcp/' + address.port)
      if (ipfsId) {
        m = m.encapsulate('/ipfs/' + ipfsId)
      }

      if (m.toString().indexOf('0.0.0.0') !== -1) {
        const netInterfaces = os.networkInterfaces()
        Object.keys(netInterfaces).forEach((niKey) => {
          netInterfaces[niKey].forEach((ni) => {
            if (ni.family === 'IPv4') {
              multiaddrs.push(multiaddr(m.toString().replace('0.0.0.0', ni.address)))
            }
          })
        })
      } else {
        multiaddrs.push(m)
      }
    }

    if (address.family === 'IPv6') {
      let ma = multiaddr('/ip6/' + address.address + '/tcp/' + address.port)
      if (ipfsId) {
        ma = ma.encapsulate('/ipfs/' + ipfsId)
      }

      multiaddrs.push(ma)
    }

    callback(null, multiaddrs)
  }

  return listener
}

function getIpfsId (ma) {
  return ma.stringTuples().filter((tuple) => {
    return tuple[0] === IPFS_CODE
  })[0][1]
}
