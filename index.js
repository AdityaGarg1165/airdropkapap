const express = require('express');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Serve static files from the "public" directory
app.use(express.static('public'));

// Middleware to parse JSON requests
app.use(express.json());

// Route to get public IP address
app.get('/', (req, res) => {
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`Incoming request from IP: ${ipAddress}`);
    res.send(`Your public IP address is: ${ipAddress}`);
});

const fileChunks = {};
const users = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    const ipAddress = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    if (!users[ipAddress]) {
        users[ipAddress] = [socket.id];
    } else {
        users[ipAddress].push(socket.id);
        const fil = users[ipAddress].filter(x => x !== socket.id)
        fil.forEach(x=>{
            io.to(socket.id).emit("peer",x)
        })


            const filtered = users[ipAddress].filter(x => x !== socket.id)
            filtered.forEach(x=>{
                io.to(x).emit("peer",socket.id)
        })
        
    }

    console.log(users);

    socket.join(ipAddress);

    socket.on('message', (msg) => {
        console.log(`Message from ${ipAddress}: ${msg}`);
        io.to(ipAddress).emit('message', msg); 
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        users[ipAddress] = users[ipAddress].filter(x => x !== socket.id);
        io.to(ipAddress).emit("disconnected",socket.id);
    });

    socket.on('chunks', (data) => {
        const { fileName, fileType, currentChunk, totalChunks, chunkData } = data;

        if (chunkData !== "uc") {
            if (!fileChunks[fileName]) {
                fileChunks[fileName] = [];
            }

            fileChunks[fileName].push(Buffer.from(chunkData));
            const progress = ((currentChunk + 1) / totalChunks) * 100;
            socket.emit('progress', { fileName, progress });

            // Emit the chunk to other users
            users[ipAddress].forEach(x => {
                if (x !== socket.id) {
                    io.to(x).emit("receiveChunks", {
                        fileName: fileName,
                        currentChunk: currentChunk,
                        totalChunks: totalChunks,
                        chunkData: chunkData,
                        fileType: fileType
                    });
                }
            });

            console.log(`Received chunk ${currentChunk + 1}/${totalChunks} for file ${fileName}`);
        } else {
            // Handle finalizing the file upload
            const fileBuffer = Buffer.concat(fileChunks[fileName]);
            const savedFilePath = `./uploads/${fileName}`;

            fs.writeFile(savedFilePath, fileBuffer, (err) => {
                if (err) {
                    console.error(`Error saving file: ${err}`);
                } else {
                    console.log(`File ${fileName} saved successfully.`);
                    io.emit('fileSaved', { fileName });
                }
            });

            // Clear file chunks for the next upload
            delete fileChunks[fileName];
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
