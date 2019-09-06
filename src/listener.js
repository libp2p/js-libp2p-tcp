'use strict'

const multiaddr = require('multiaddr')
const os = require('os')
const net = require('net')
const EventEmitter = require('events')
const log = require('debug')('libp2p:tcp:listener')
const toConnection = require('./socket-to-conn')
const { IPFS_MA_CODE, CLOSE_TIMEOUT } = require('./constants')

module.exports = ({ handler, upgrader }, options) => {
  const listener = new EventEmitter()

  const server = net.createServer(async socket => {
    // Avoid uncaught errors caused by unstable connections
    socket.on('error', err => log('socket error', err))

    const maConn = toConnection(socket)
    const conn = upgrader.upgradeInbound(maConn)
    log('new connection %s', conn.remoteAddr)

    trackConn(server, maConn)

    if (handler) handler(conn)
    listener.emit('connection', conn)
  })

  server
    .on('listening', () => listener.emit('listening'))
    .on('error', err => listener.emit('error', err))
    .on('close', () => listener.emit('close'))

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
        Object.keys(server.__connections).forEach(key => {
          log('destroying %s', key)
          server.__connections[key].conn.destroy()
        })
        resolve()
      }, options.timeout || CLOSE_TIMEOUT)

      server
        .once('close', () => clearTimeout(timeout))
        .close(err => err ? reject(err) : resolve())
    })
  }

  let ipfsId
  let listeningAddr

  listener.listen = (ma) => {
    listeningAddr = ma
    if (ma.protoNames().includes('ipfs')) {
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
  return ma.stringTuples().filter(tuple => tuple[0] === IPFS_MA_CODE)[0][1]
}

function trackConn (server, maConn) {
  const key = maConn.remoteAddr.toString()
  server.__connections[key] = maConn

  maConn.conn.once('close', () => {
    delete server.__connections[key]
  })
}
