// index.js (Backend)

const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken'); // <--- NEW IMPORT
const port = process.env.PORT || 3000

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mjn1osb.mongodb.net/?appName=Cluster0`;


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let userCollection; 

async function run() {
  try {
    await client.connect();

    const db=client.db('tution_db');

    userCollection = db.collection('users');

    // API Endpoint to Save User Profile on Registration/Social Login
    app.post('/users', async (req, res) => {
        const user = req.body;
        const query = { email: user.email };
        const existingUser = await userCollection.findOne(query);

        if (existingUser) {
            return res.send({ message: 'User already exists in DB', insertedId: null });
        }
        
        const result = await userCollection.insertOne(user);
        res.send(result);
    });
    
    // API Endpoint to Generate and Send JWT Token <--- NEW ROUTE
    app.post('/jwt', async (req, res) => {
        const user = req.body;
        
        // 1. Fetch user role from MongoDB
        const dbUser = await userCollection.findOne({ email: user.email });
        const userRole = dbUser ? dbUser.role : 'Student'; // Default to Student if role not found
        
        // 2. Create the payload with identifying information and the role
        const payload = {
            email: user.email,
            role: userRole,
        };
        
        // 3. Generate the JWT token (Requires ACCESS_TOKEN_SECRET in .env)
        const token = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
        
        // 4. Send the token back to the client
        res.send({ token });
    });


    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    //
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Tution is coming..')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})