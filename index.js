// index.js (Backend)

const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
// CHANGED: ObjectId imported to correctly sort by creation time
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb'); 
const jwt = require('jsonwebtoken'); 
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
let tuitionsCollection; 
let tutorProfilesCollection; 


async function run() {
  try {
    await client.connect();

    const db=client.db('tution_db');

    userCollection = db.collection('users');
    tuitionsCollection = db.collection('tuitions');
    tutorProfilesCollection = db.collection('tutorProfiles');
    
    // Seed sample data if collections are empty (for fresh data on first run)
    const tuitionCount = await tuitionsCollection.countDocuments();
    if (tuitionCount === 0) {
        // Assume sampleTuitions is defined elsewhere or skip seeding here for brevity
        // await tuitionsCollection.insertMany(sampleTuitions);
        console.log("Skipped inserting sample tuition posts.");
    }
    
    const tutorCount = await tutorProfilesCollection.countDocuments();
    if (tutorCount === 0) {
        // Assume sampleTutors is defined elsewhere or skip seeding here for brevity
        // await tutorProfilesCollection.insertMany(sampleTutors);
        console.log("Skipped inserting sample tutor profiles.");
    }
    
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
    
    // API Endpoint to Generate and Send JWT Token 
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

    // NEW API: Get Latest 6 Tuition Posts for Home Page (CHANGED TO POST ROUTE)
    app.post('/latest-tuitions', async (req, res) => { // CHANGED FROM app.get
        // Sort by 'createdAt' time (descending) and limit to 6
        const latestTuitions = await tuitionsCollection
            .find({})
            .sort({ createdAt: -1 }) 
            .limit(6)
            .toArray();
        res.send(latestTuitions);
    });
   
    // API: Post New Tuition (CREATE)
    app.post('/tuition', async (req, res) => {
        const post = req.body;
        
        // Ensure required fields like studentEmail are present (assuming this comes from AuthContext/body)
        if (!post.studentEmail || !post.subject) {
            return res.status(400).send({ message: "Missing required fields." });
        }

        const tuitionPost = {
            ...post,
            createdAt: new Date(),
            status: 'Pending', // Default status: Pending for admin review
        };

        try {
            const result = await tuitionsCollection.insertOne(tuitionPost);
            res.send({ 
                acknowledged: true, 
                insertedId: result.insertedId, 
                message: "Tuition post submitted successfully. It is currently pending admin review." 
            });
        } catch (error) {
            console.error("Error posting tuition:", error);
            res.status(500).send({ message: "Failed to post tuition due to a server error." });
        }
    });

    // NEW API: Get Tuitions by Student Email (READ - My Tuitions)
    app.post('/my-tuitions', async (req, res) => {
        const { email } = req.body;
        if (!email) {
            return res.status(400).send({ message: "Student email is required." });
        }
        try {
            const myTuitions = await tuitionsCollection
                .find({ studentEmail: email })
                .sort({ createdAt: -1 }) 
                .toArray();
            res.send(myTuitions);
        } catch (error) {
            console.error("Error fetching my tuitions:", error);
            res.status(500).send({ message: "Failed to fetch tuitions." });
        }
    });
    
    // NEW API: Update a Tuition Post (UPDATE)
    app.put('/tuition/:id', async (req, res) => {
        const id = req.params.id;
        const updatedPost = req.body;
        
        // Prepare data for update (excluding _id)
        const { _id, studentEmail, createdAt, ...updateDoc } = updatedPost;

        const filter = { _id: new ObjectId(id) };
        const updateOperation = {
            $set: updateDoc,
        };

        try {
            const result = await tuitionsCollection.updateOne(filter, updateOperation);
            
            if (result.matchedCount === 0) {
                return res.status(404).send({ message: "Tuition post not found." });
            }

            res.send({ 
                acknowledged: true, 
                modifiedCount: result.modifiedCount,
                message: "Tuition post updated successfully." 
            });
        } catch (error) {
            console.error("Error updating tuition:", error);
            res.status(500).send({ message: "Failed to update tuition." });
        }
    });

    // NEW API: Delete a Tuition Post (DELETE)
    app.delete('/tuition/:id', async (req, res) => {
        const id = req.params.id;
        try {
            const result = await tuitionsCollection.deleteOne({ _id: new ObjectId(id) });

            if (result.deletedCount === 0) {
                return res.status(404).send({ message: "Tuition post not found." });
            }

            res.send({ 
                acknowledged: true, 
                deletedCount: result.deletedCount,
                message: "Tuition post deleted successfully." 
            });
        } catch (error) {
            console.error("Error deleting tuition:", error);
            res.status(500).send({ message: "Failed to delete tuition." });
        }
    });
    
    // NEW API: Get Latest 3 Tutor Profiles for Home Page (CHANGED TO POST ROUTE)
    app.post('/latest-tutors', async (req, res) => { // CHANGED FROM app.get
        // Sort by 'createdAt' time (descending) and limit to 3
        const latestTutors = await tutorProfilesCollection
            .find({})
            .sort({ createdAt: -1 }) 
            .limit(3)
            .toArray();
        res.send(latestTutors);
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