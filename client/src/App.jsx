import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import CryptoJS from 'crypto-js';

const socket = io(`${import.meta.env.VITE_API_URL}`);

function App() {
  const [roomId, setRoomId] = useState('');
  const [currentRoom, setCurrentRoom] = useState(null);
  const [roomSizeLimit, setRoomSizeLimit] = useState(2);
  
  const [peers, setPeers] = useState([]);
  const [p2pConnected, setP2pConnected] = useState(false);
  const [systemMessage, setSystemMessage] = useState('');
  const [file, setFile] = useState(null);
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [transferProgress, setTransferProgress] = useState(0);
  
  const rtcPeersRef = useRef({});
  const dataChannelsRef = useRef({});
  const fileInputRef = useRef(null);
  const receiveBuffer = useRef({});
  const pendingCandidates = useRef({}); 

  // Public Google STUN server for NAT traversal
  const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  useEffect(() => {
    socket.on('roomCreated', (id) => {
      setRoomId(id);
      setCurrentRoom(id);
      socket.emit('joinRoom', id);
      setSystemMessage(`Room ${id} active.`);
    });

    socket.on('usersInRoom', (existingPeers) => {
      setPeers(existingPeers);
      existingPeers.forEach(peerId => {
        initiateNativeConnection(peerId);
      });
    });

    socket.on('newUserJoined', (peerId) => {
      setPeers(prev => prev.includes(peerId) ? prev : [...prev, peerId]);
      setSystemMessage(`New peer connected: ${peerId}. Awaiting WebRTC offer...`);
    });

    // SIGNALING HANDLER: Handles Offers, Answers, and Buffers early ICE Candidates
    socket.on('signal', async ({ from, signal }) => {
      try {
        let peer = rtcPeersRef.current[from];

        if (signal.type === 'offer') {
          if (!peer) peer = createNativePeer(from);
          
          await peer.setRemoteDescription(new RTCSessionDescription(signal));
          
          if (pendingCandidates.current[from]) {
            pendingCandidates.current[from].forEach(c => peer.addIceCandidate(c));
            pendingCandidates.current[from] = [];
          }

          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socket.emit('signal', { targetId: from, signal: peer.localDescription });
        } 
        else if (signal.type === 'answer') {
          if (peer) {
            await peer.setRemoteDescription(new RTCSessionDescription(signal));
            if (pendingCandidates.current[from]) {
              pendingCandidates.current[from].forEach(c => peer.addIceCandidate(c));
              pendingCandidates.current[from] = [];
            }
          }
        } 
        else if (signal.candidate) {
          const iceCandidate = new RTCIceCandidate(signal);
          if (peer && peer.remoteDescription) {
            await peer.addIceCandidate(iceCandidate);
          } else {
            if (!pendingCandidates.current[from]) pendingCandidates.current[from] = [];
            pendingCandidates.current[from].push(iceCandidate);
          }
        }
      } catch (err) {
        console.error("Signaling error:", err);
      }
    });

    socket.on('userLeft', ({ peerId }) => {
      if (rtcPeersRef.current[peerId]) {
        rtcPeersRef.current[peerId].close();
        delete rtcPeersRef.current[peerId];
        delete dataChannelsRef.current[peerId];
        delete pendingCandidates.current[peerId];
      }
      setPeers(prev => prev.filter(id => id !== peerId));
      setP2pConnected(false);
      setSystemMessage(`Peer disconnected: ${peerId}`);
    });

    return () => {
      socket.off('roomCreated');
      socket.off('usersInRoom');
      socket.off('newUserJoined');
      socket.off('signal');
      socket.off('userLeft');
    };
  }, []);

  const createNativePeer = (peerId) => {
    const peer = new RTCPeerConnection(config);
    rtcPeersRef.current[peerId] = peer;

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', { targetId: peerId, signal: event.candidate });
      }
    };

    peer.ondatachannel = (event) => {
      setupDataChannel(event.channel, peerId);
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') {
        setSystemMessage('WebRTC Network Blocked (Firewall or NAT issue).');
      }
    };

    return peer;
  };

  const initiateNativeConnection = async (peerId) => {
    const peer = createNativePeer(peerId);
    const channel = peer.createDataChannel('sharemesh-secure');
    setupDataChannel(channel, peerId);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit('signal', { targetId: peerId, signal: peer.localDescription });
  };

  const setupDataChannel = (channel, peerId) => {
    dataChannelsRef.current[peerId] = channel;

    const handleChannelOpen = () => {
      setP2pConnected(true);
      setSystemMessage('Native P2P Data Channel securely established.');
    };

    if (channel.readyState === 'open') {
      handleChannelOpen();
    } else {
      channel.onopen = handleChannelOpen;
    }

    channel.onclose = () => setP2pConnected(false);

    // RECEPTION LOGIC: Chunk Reassembly & Decryption
    channel.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'meta') {
          receiveBuffer.current = {
            name: parsed.name,
            key: parsed.key,
            total: parsed.totalChunks,
            chunks: []
          };
          setSystemMessage(`Incoming stream: ${parsed.name}...`);
        } else if (parsed.type === 'chunk') {
          receiveBuffer.current.chunks.push(parsed.data);
          
          if (receiveBuffer.current.chunks.length === receiveBuffer.current.total) {
            const assembled = receiveBuffer.current.chunks.join('');
            const decrypted = CryptoJS.AES.decrypt(assembled, receiveBuffer.current.key).toString(CryptoJS.enc.Utf8);
            
            // Extract safely before flushing the buffer
            const finalName = receiveBuffer.current.name;
            const finalContent = decrypted;
            
            setReceivedFiles(prev => [...prev, { name: finalName, content: finalContent }]);
            setSystemMessage(`Cryptographic assembly complete: ${finalName}`);
            
            // Flush memory safely
            receiveBuffer.current = {};
          }
        }
      } catch (e) {
        console.error('Data parsing error:', e);
      }
    };
  };

  const handleFileSelection = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) setFile(selectedFile);
  };

  // TRANSMISSION LOGIC: Encryption, Chunking, and Backpressure
  const transmitFile = () => {
    if (!file || !p2pConnected) return;

    if (file.size === 0) {
      setSystemMessage('TRANSMISSION BLOCKED: Zero-byte file detected.');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSystemMessage('Encrypting payload... (Large files may take a moment)');
    const reader = new FileReader();
    
    reader.onload = () => {
      const fullDataUrl = reader.result;
      const encryptionKey = CryptoJS.lib.WordArray.random(16).toString();
      const encryptedString = CryptoJS.AES.encrypt(fullDataUrl, encryptionKey).toString();
      
      const chunkSize = 16384; 
      const totalChunks = Math.ceil(encryptedString.length / chunkSize);

      const metaPayload = JSON.stringify({
        type: 'meta', name: file.name, key: encryptionKey, totalChunks
      });

      Object.values(dataChannelsRef.current).forEach(channel => {
        if (channel.readyState === 'open') channel.send(metaPayload);
      });

      let currentChunk = 0;
      
      const sendNextChunk = () => {
        if (currentChunk >= totalChunks) {
          setSystemMessage(`Transmission complete. Sent ${totalChunks} encrypted chunks.`);
          setTransferProgress(0);
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        // BACKPRESSURE: Monitor the browser's buffer to prevent massive file overflow
        let bufferFull = false;
        Object.values(dataChannelsRef.current).forEach(channel => {
          if (channel.readyState === 'open' && channel.bufferedAmount > 65535) {
            bufferFull = true;
          }
        });

        if (bufferFull) {
          setTimeout(sendNextChunk, 50);
          return;
        }

        const start = currentChunk * chunkSize;
        const chunkData = encryptedString.slice(start, start + chunkSize);
        const chunkPayload = JSON.stringify({ type: 'chunk', data: chunkData });

        Object.values(dataChannelsRef.current).forEach(channel => {
          if (channel.readyState === 'open') channel.send(chunkPayload);
        });

        currentChunk++;
        setTransferProgress(Math.round((currentChunk / totalChunks) * 100));
        
        setTimeout(sendNextChunk, 0);
      };
      
      sendNextChunk();
    };
    reader.readAsDataURL(file);
  };

  const downloadFile = (fileObj) => {
    const a = document.createElement('a');
    a.href = fileObj.content;
    a.download = fileObj.name;
    a.click();
  };

  const leaveRoom = () => {
    if (currentRoom) {
      socket.emit('leaveRoom', currentRoom);
      setCurrentRoom(null);
      setPeers([]);
      setP2pConnected(false);
      setRoomId('');
      setSystemMessage('');
      
      Object.values(rtcPeersRef.current).forEach(peer => peer.close());
      rtcPeersRef.current = {};
      dataChannelsRef.current = {};
      pendingCandidates.current = {};
    }
  };

  return (
    <div className="container py-5 max-w-md">
      <h2 className="mb-4 text-primary fw-bold">ShareMesh Core</h2>
      
      {systemMessage && (
        <div className="alert alert-dark py-2 shadow-sm font-monospace small">
          {systemMessage}
        </div>
      )}

      {!currentRoom ? (
        <div className="card shadow-sm p-4">
          <div className="mb-4">
            <h4>Initialize Node</h4>
            <select 
              className="form-select mb-2" 
              value={roomSizeLimit} 
              onChange={(e) => setRoomSizeLimit(Number(e.target.value))}
            >
              <option value={2}>Limit: 2 Peers</option>
              <option value={5}>Limit: 5 Peers</option>
            </select>
            <button onClick={() => socket.emit('createRoom', roomSizeLimit)} className="btn btn-primary w-100">
              Generate Secure Room
            </button>
          </div>
          <hr />
          <div>
            <h4>Connect to Mesh</h4>
            <input 
              type="text" 
              className="form-control mb-2" 
              placeholder="Room ID" 
              value={roomId} 
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            />
            <button onClick={() => { setSystemMessage(''); setCurrentRoom(roomId); socket.emit('joinRoom', roomId); }} className="btn btn-outline-primary w-100">
              Join Room
            </button>
          </div>
        </div>
      ) : (
        <div className="card shadow-sm p-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h4 className="m-0">Active Room: <span className="text-primary">{currentRoom}</span></h4>
            <button onClick={leaveRoom} className="btn btn-sm btn-danger">Disconnect</button>
          </div>
          
          <div className="bg-light p-3 rounded mb-4">
            <strong>Active Socket Connections: {peers.length}</strong>
            <ul className="mb-0 mt-2 font-monospace small">
              {peers.map(p => <li key={p} className="text-muted">{p}</li>)}
            </ul>
            <div className={`mt-2 badge ${p2pConnected ? 'bg-success' : 'bg-warning text-dark'}`}>
              {p2pConnected ? 'WebRTC Channel Open' : 'Negotiating WebRTC...'}
            </div>
          </div>

          <div className="border p-3 rounded mb-4">
            <h5 className="mb-3">Secure File Transfer</h5>
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileSelection} 
              className="form-control mb-2"
            />
            <button 
              onClick={transmitFile} 
              disabled={!file || !p2pConnected}
              className="btn btn-success w-100 mb-2"
            >
              Encrypt & Send to Mesh
            </button>
            
            {transferProgress > 0 && (
              <div className="progress mt-2" style={{ height: '10px' }}>
                <div 
                  className="progress-bar progress-bar-striped progress-bar-animated bg-success" 
                  style={{ width: `${transferProgress}%` }}
                ></div>
              </div>
            )}
          </div>

          {receivedFiles.length > 0 && (
            <div>
              <h5 className="mb-3">Decrypted Payloads</h5>
              <ul className="list-group">
                {receivedFiles.map((f, index) => (
                  <li key={index} className="list-group-item d-flex justify-content-between align-items-center">
                    <span className="text-truncate" style={{maxWidth: '200px'}}>{f.name}</span>
                    <button onClick={() => downloadFile(f)} className="btn btn-sm btn-outline-secondary">
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;