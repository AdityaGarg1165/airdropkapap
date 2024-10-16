const express = require('express');
const path = require("path")
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;


app.use(express.static('public'));


app.use(express.json());

// Routes
app.get('/', (req, res) => {
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`Incoming request from IP: ${ipAddress}`);
    res.send(`Your public IP address is: ${ipAddress}`);
});



app.get('/download/:filename', (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(__dirname, filename); // Use the filename from the URL

    // Check if the file exists
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            console.error('File not found:', filename);
            return res.status(404).send('File not found.');
        }
        
        // Serve the file for download
        res.download(filePath, (err) => {
            if (err) {
                console.error('Error downloading the file:', err);
                res.status(500).send('Error downloading the file.');
            } else {
                // Delete the file after download is complete
                fs.unlink(filePath, (err) => {
                    if (err) {
                        console.error(`Error deleting file: ${filename}`, err);
                    } else {
                        console.log(`File ${filename} was deleted successfully after download.`);
                    }
                });
            }
        });
    });
});


app.get('/link', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'link.html');
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('Error sending file:', err);
            res.status(err.status).end();
        } else {
            console.log('link.html sent successfully');
        }
    });
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

    socket.on("remove",()=>{
        users[ipAddress] = users[ipAddress].filter(x=>x !== socket.id)
    })

    socket.on('fileComplete', (data) => {
        socket.emit('uploadSuccess');
    });

    socket.emit("selfId",socket.id)

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
    
            
            delete fileChunks[fileName];
        }
    });
    
    const linkFileChunks = {}
    
    socket.on("linkchunks",(data)=>{
        const { fileName, fileType, currentChunk, totalChunks, chunkData } = data;
        if(!linkFileChunks[fileName]){
            
            linkFileChunks[fileName] = []
        }
        console.log(data.code)
        
        linkFileChunks[fileName].push(Buffer.from(chunkData))
        
        if(chunkData === "uc"){
            const fileBuffer = Buffer.concat(linkFileChunks[fileName])
            

            fs.writeFile(socket.id + fileName, fileBuffer, (err) => {
                delete fileChunks[fileName];
            });

        
        }
        

        
    })


const CHUNK_SIZE = 695450
socket.on("requestFile",(data)=>{
    const filePath = path.join(__dirname, '3_Idiots.mp4');
    const fileStat = fs.statSync(filePath);
    const totalChunks = Math.ceil(fileStat.size / CHUNK_SIZE);
    let currentChunk = 0;
    const sendChunk = () => {
        const start = currentChunk * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileStat.size);
        const readStream = fs.createReadStream(filePath, { start, end: end - 1 });

        readStream.on('data', (chunk) => {
            socket.emit('requestedChunk', {
                fileName:"sdf.mp4",
                totalChunks,
                currentChunk,
                chunk: chunk.toString('base64')
            });
        });

        readStream.on('end', () => {
            currentChunk++;
            if (currentChunk < totalChunks) {
                sendChunk();
            }
        });
    };

    sendChunk();
})


});

const deleteOldFiles = () => {
    const directoryPath = path.join(__dirname); // Directory to check for old files
    fs.readdir(directoryPath, (err, files) => {
        if (err) {
            console.error('Error reading directory:', err);
            return;
        }

        const now = Date.now();
        const twentyFourHours = 60 * 1000; // 24 hours in milliseconds

        files.forEach((file) => {

            const filePath = path.join(directoryPath, file);
            

            // Exclude .js and .json files from deletion
            if (file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.lock') || file.endsWith('.html')) {
                console.log(`Skipping deletion of file: ${file}`);
                return;
            }

            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.error('Error getting file stats:', err);
                    return;
                }

                const fileAge = now - stats.mtimeMs; // Time since last modified
                if (fileAge > twentyFourHours) {
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            console.error('Error deleting file:', err);
                        } else {
                            console.log(`Deleted old file: ${file}`);
                        }
                    });
                }
            });
        });
    });
};

// Schedule file deletion every hour
setInterval(deleteOldFiles,60 * 1000); // Check every hour





server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
