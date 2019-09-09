'use strict'

const multiaddr = require('multiaddr')
const os = require('os')
const net = require('net')
const EventEmitter = require('events')
const log = require('debug')('libp2p:tcp:listener')
const toConnection = require('./socket-to-conn')
const { IPFS_MA_CODE } = require('./constants')
const ProtoFamily = { ip4: 'IPv4', ip6: 'IPv6' }

module.exports = ({ handler, upgrader }, options) => {
  const listener = new EventEmitter()

  const server = net.createServer(async socket => {
    // Avoid uncaught errors caused by unstable connections
    socket.on('error', err => log('socket error', err))

    const maConn = toConnection(socket)
    log('new inbound connection %s', maConn.remoteAddr)

    const conn = await upgrader.upgradeInbound(maConn)
    log('inbound connection %s upgraded', maConn.remoteAddr)

    trackConn(server, maConn)

    if (handler) handler(conn)
    listener.emit('connection', conn)
  })

  server
    .on('listening', () => listener.emit('listening'))
    .on('error', err => listener.emit('error', err))
    .on('close', () => listener.emit('close'))

  // Keep track of open connections to destroy in case of timeout
  server.__connections = []

  listener.close = () => {
    if (!server.listening) return

    return new Promise((resolve, reject) => {
      server.__connections.forEach(maConn => maConn.close())
      server.close(err => err ? reject(err) : resolve())
    })
  }

  let ipfsId, listeningAddr

  listener.listen = ma => {
    listeningAddr = ma
    if (ma.protoNames().includes('ipfs')) {
      ipfsId = getIpfsId(ma)
      listeningAddr = ma.decapsulate('ipfs')
    }

    return new Promise((resolve, reject) => {
      const { host, port } = listeningAddr.toOptions()
      server.listen(port, host, err => {
        if (err) return reject(err)
        log('Listening on %s %s', port, host)
        resolve()
      })
    })
  }

  listener.getAddrs = () => {
    let addrs = []
    const address = server.address()

    if (!address) {
      throw new Error('Listener is not ready yet')
    }

    // Because TCP will only return the IPv6 version
    // we need to capture from the passed multiaddr
    if (listeningAddr.toString().startsWith('/ip4')) {
      addrs = addrs.concat(getMulitaddrs('ip4', address.address, address.port))
    } else if (address.family === 'IPv6') {
      addrs = addrs.concat(getMulitaddrs('ip6', address.address, address.port))
    }

    return addrs.map(ma => ipfsId ? ma.encapsulate(`/ipfs/${ipfsId}`) : ma)
  }

  return listener
}

function getMulitaddrs (proto, ip, port) {
  const toMa = ip => multiaddr(`/${proto}/${ip}/tcp/${port}`)
  return (isAnyAddr(ip) ? getNetworkAddrs(ProtoFamily[proto]) : [ip]).map(toMa)
}

function isAnyAddr (ip) {
  return ['0.0.0.0', '::'].includes(ip)
}

function getNetworkAddrs (family) {
  return [].concat(Object.values(os.networkInterfaces()))
    .filter((netAddr) => netAddr.family === family)
    .map(({ address }) => address)
}

function getIpfsId (ma) {
  return ma.stringTuples().filter(tuple => tuple[0] === IPFS_MA_CODE)[0][1]
}

function trackConn (server, maConn) {
  server.__connections.push(maConn)

  const untrackConn = () => {
    server.__connections = server.__connections.filter(c => c !== maConn)
  }

  maConn.conn.on('close', untrackConn).on('error', untrackConn)
}
