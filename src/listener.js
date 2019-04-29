'use strict'

const multiaddr = require('multiaddr')
const os = require('os')
const includes = require('lodash.includes')
const net = require('net')
const EventEmitter = require('events').EventEmitter
const debug = require('debug')
const log = debug('libp2p:tcp:listen')

const Libp2pSocket = require('./socket')
const getMultiaddr = require('./get-multiaddr')
const c = require('./constants')

function noop () {}

module.exports = (handler) => {
  const listener = new EventEmitter()

  const server = net.createServer((socket) => {
    // Avoid uncaught errors caused by unstable connections
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

    const s = new Libp2pSocket(socket, addr)
    trackSocket(server, socket)

    handler && handler(s)
    listener.emit('connection', s)
  })

  server.on('listening', () => listener.emit('listening'))
  server.on('error', (err) => listener.emit('error', err))
  server.on('close', () => listener.emit('close'))

  // Keep track of open connections to destroy in case of timeout
  server.__connections = {}

  listener.close = (options = {}) => {
    if (!server.listening) {
      return
    }

    return new Promise((resolve, reject) => {
      const start = Date.now()

      // Attempt to stop the server. If it takes longer than the timeout,
      // destroy all the underlying sockets manually.
      const timeout = setTimeout(() => {
        log('Timeout closing server after %dms, destroying connections manually', Date.now() - start)
        Object.keys(server.__connections).forEach((key) => {
          log('destroying %s', key)
          server.__connections[key].destroy()
        })
        resolve()
      }, options.timeout || c.CLOSE_TIMEOUT)

      server.once('close', () => clearTimeout(timeout))

      server.close((err) => err ? reject(err) : resolve())
    })
  }

  let ipfsId
  let listeningAddr

  listener.listen = (ma) => {
    listeningAddr = ma
    if (includes(ma.protoNames(), 'ipfs')) {
      ipfsId = getIpfsId(ma)
      listeningAddr = ma.decapsulate('ipfs')
    }

    const lOpts = listeningAddr.toOptions()
    return new Promise((resolve, reject) => {
      server.listen(lOpts.port, lOpts.host, (err) => {
        if (err) {
          return reject(err)
        }

        log('Listening on %s %s', lOpts.port, lOpts.host)
        resolve()
      })
    })
  }

  listener.getAddrs = () => {
    const multiaddrs = []
    const address = server.address()

    if (!address) {
      throw new Error('Listener is not ready yet')
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

    return multiaddrs
  }

  return listener
}

function getIpfsId (ma) {
  return ma.stringTuples().filter((tuple) => {
    return tuple[0] === c.IPFS_MA_CODE
  })[0][1]
}

function trackSocket (server, socket) {
  const key = `${socket.remoteAddress}:${socket.remotePort}`
  server.__connections[key] = socket

  socket.once('close', () => {
    delete server.__connections[key]
  })
}
