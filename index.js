const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
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

let userCollection; // Declare a variable to hold the collection

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db=client.db('tution_db');

    // Create a reference to the 'users' collection
    userCollection = db.collection('users'); // <--- NEW: Define userCollection

    // API Endpoint to Save User Profile on Registration
    app.post('/users', async (req, res) => { // <--- NEW ROUTE
        const user = req.body;
        // Optional: Check if user already exists based on email
        const query = { email: user.email };
        const existingUser = await userCollection.findOne(query);

        if (existingUser) {
            return res.send({ message: 'User already exists in DB', insertedId: null });
        }
        
        const result = await userCollection.insertOne(user);
        res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Removed client.close() from here to keep the server connection active
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Tution is coming..')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})