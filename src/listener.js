'use strict'

const multiaddr = require('multiaddr')
const Connection = require('interface-connection').Connection
const os = require('os')
const net = require('net')
const toPull = require('stream-to-pull-stream')
const EventEmitter = require('events').EventEmitter
const debug = require('debug')
const log = debug('libp2p:tcp:listen')

const getMultiaddr = require('./get-multiaddr')

const CLOSE_TIMEOUT = 2000

function noop () {}

module.exports = (handler) => {
  const listener = new EventEmitter()

  const server = net.createServer((socket) => {
    // Avoid uncaught errors cause by unstable connections
    socket.on('error', noop)

    const addr = getMultiaddr(socket)
    if (!addr) {
      if (socket.remoteAddress === undefined) {
        log('connection closed before p2p connection made')
      } else {
        log('error interpreting incoming p2p connection')
      }
      return
    }

    log('new connection', addr.toString())

    const s = toPull.duplex(socket)

    s.getObservedAddrs = (cb) => {
      cb(null, [addr])
    }

    trackSocket(server, socket)

    const conn = new Connection(s)
    handler(conn)
    listener.emit('connection', conn)
  })

  server.on('listening', () => listener.emit('listening'))
  server.on('error', (err) => listener.emit('error', err))
  server.on('close', () => listener.emit('close'))

  // Keep track of open connections to destroy in case of timeout
  server.__connections = {}

  listener.close = (options, callback) => {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    callback = callback || noop
    options = options || {}

    const timeout = setTimeout(() => {
      log('unable to close graciously, destroying conns')
      Object.keys(server.__connections).forEach((key) => {
        log('destroying %s', key)
        server.__connections[key].destroy()
      })
    }, options.timeout || CLOSE_TIMEOUT)

    server.close(callback)

    server.once('close', () => {
      clearTimeout(timeout)
    })
  }

  let listeningAddr

  listener.listen = (ma, callback) => {
    listeningAddr = ma

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
      if (listeningAddr.toString().indexOf('0.0.0.0') !== -1) {
        const netInterfaces = os.networkInterfaces()
        Object.keys(netInterfaces).forEach((niKey) => {
          netInterfaces[niKey].forEach((ni) => {
            if (ni.family === 'IPv4') {
              multiaddrs.push(
                multiaddr(listeningAddr.toString().replace('0.0.0.0', ni.address))
              )
            }
          })
        })
      } else {
        multiaddrs.push(listeningAddr)
      }
    }

    if (address.family === 'IPv6') {
      // Listen on all available addresses when using wildcard
      if (listeningAddr.toString().indexOf('/::/') !== -1) {
        const netInterfaces = os.networkInterfaces()
        Object.keys(netInterfaces).forEach((niKey) => {
          netInterfaces[niKey].forEach((ni) => {
            if (ni.family === address.family) {
              const maOpts = listeningAddr.toOptions()
              if (maOpts.host === '::') {
                maOpts.family = address.family
                maOpts.address = ni.address
                multiaddrs.push(
                  multiaddr.fromNodeAddress(maOpts, maOpts.transport)
                )
              }
            }
          })
        })
      } else {
        multiaddrs.push(listeningAddr)
      }
    }

    callback(null, multiaddrs)
  }

  return listener
}

function trackSocket (server, socket) {
  const key = `${socket.remoteAddress}:${socket.remotePort}`
  server.__connections[key] = socket

  socket.on('close', () => {
    delete server.__connections[key]
  })
}
