
const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); 
const jwt = require('jsonwebtoken'); 
const port = process.env.PORT || 3000

const admin = require("firebase-admin");

// const serviceAccount = require("./e-tution-firebase-adminsdk.json");

// const serviceAccount = require("./firebase-admin-key.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


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
    // await client.connect();

    const db=client.db('tution_db');

    userCollection = db.collection('users');
    tuitionsCollection = db.collection('tuitions');
    tutorProfilesCollection = db.collection('tutorProfiles');
    const applicationsCollection = db.collection('applications'); // New
    const paymentsCollection = db.collection('payments'); // New

    app.get('/tutor/revenue/:email', async (req, res) => {
    const email = req.params.email;
    try {
        const payments = await paymentsCollection.aggregate([
            {
                $addFields: {
                   
                    appIdObj: { $toObjectId: "$applicationId" }
                }
            },
            {
                $lookup: {
                    from: 'applications',
                    localField: 'appIdObj',
                    foreignField: '_id',
                    as: 'appDetails'
                }
            },
            { $unwind: '$appDetails' },
            { $match: { 'appDetails.tutorEmail': email } },
            {
                $project: {
                    _id: 1,
                    transactionId: 1,
                    amount: 1,
                    date: 1,
                    subject: "$appDetails.subject",
                    studentEmail: 1
                }
            }
        ]).toArray();
        res.send(payments);
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch revenue" });
    }
});

app.get('/student-profile/:email', async (req, res) => {
    const email = req.params.email;
    try {
        const result = await userCollection.findOne({ email: email });
        res.send(result || {});
    } catch (error) {
        res.status(500).send({ message: "Error fetching student profile" });
    }
});

app.patch('/student-profile-update', async (req, res) => {
    const profile = req.body;
    const filter = { email: profile.email };
    const updateDoc = {
        $set: {
            name: profile.name,
            phone: profile.phone,
            institution: profile.institution, 
            address: profile.address,         
            lastUpdated: new Date()
        },
    };
    try {
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Update failed" });
    }
});

  app.get('/tutor-profile/:email', async (req, res) => {
    const email = req.params.email;
    try {
        const result = await tutorProfilesCollection.findOne({ tutorEmail: email });
    
        res.send(result || {}); 
    } catch (error) {
        res.status(500).send({ message: "Error fetching profile" });
    }
});



app.patch('/tutor-profile-update', async (req, res) => {
    const profile = req.body;
    const filter = { tutorEmail: profile.tutorEmail };
    const options = { upsert: true };
    const updateDoc = {
        $set: {
            name: profile.name,
            photo: profile.photo,
            university: profile.university,
            specialization: profile.specialization,
            experience: profile.experience,
            bio: profile.bio,
            lastUpdated: new Date()
        },
    };
    const result = await tutorProfilesCollection.updateOne(filter, updateDoc, options);
    res.send(result);
});

    app.get('/all-tutors', async (req, res) => {
    try {
        const result = await tutorProfilesCollection.find().toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch tutors" });
    }
});
     
    app.get('/admin/all-tuitions', async (req, res) => {
    const result = await tuitionsCollection.find().sort({ createdAt: -1 }).toArray();
    res.send(result);
});

app.patch('/admin/tuition-status/:id', async (req, res) => {
    const id = req.params.id;
    const { status } = req.body; // 'Approved' or 'Rejected'
    const result = await tuitionsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: status } }
    );
    res.send(result);
});

app.get('/admin/stats', async (req, res) => {
    const totalEarnings = await paymentsCollection.aggregate([
        { $group: { _id: null, total: { $sum: "$amount" } } }
    ]).toArray();

    const totalUsers = await userCollection.countDocuments();
    const totalTuitions = await tuitionsCollection.countDocuments();
    const transactions = await paymentsCollection.find().sort({ date: -1 }).toArray();

    res.send({
        totalEarnings: totalEarnings[0]?.total || 0,
        totalUsers,
        totalTuitions,
        transactions
    });
});
  
    app.get('/users', async (req, res) => {
    const result = await userCollection.find().toArray();
    res.send(result);
});


app.patch('/users/:id', async (req, res) => {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };
    const updatedUser = req.body;
    const updateDoc = {
        $set: {
            name: updatedUser.name,
            phone: updatedUser.phone,
            role: updatedUser.role,
            status: updatedUser.status 
        },
    };
    const result = await userCollection.updateOne(filter, updateDoc);
    res.send(result);
});

// Delete User Account
app.delete('/users/:id', async (req, res) => {
    const id = req.params.id;
    const result = await userCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
});

//  Submit Application
app.post('/applications', async (req, res) => {
    const application = req.body;
    
    const query = { tuitionId: application.tuitionId, tutorEmail: application.tutorEmail };
    const existing = await applicationsCollection.findOne(query);
    if (existing) return res.status(400).send({ message: "Already applied!" });

    const result = await applicationsCollection.insertOne({
        ...application,
        status: 'Pending',
        appliedAt: new Date()
    });
    res.send(result);
});

// Get Tutor's Applications
app.get('/tutor-applications/:email', async (req, res) => {
    const email = req.params.email;
    const result = await applicationsCollection.find({ tutorEmail: email }).toArray();
    res.send(result);
});

//  Delete Application (Before approval)
app.delete('/application-cancel/:id', async (req, res) => {
    const id = req.params.id;
    const result = await applicationsCollection.deleteOne({ _id: new ObjectId(id), status: 'Pending' });
    res.send(result);
});

// Get Ongoing Tuitions (Approved ones)
app.get('/ongoing-tuitions/:email', async (req, res) => {
    const email = req.params.email;
    const result = await applicationsCollection.find({ tutorEmail: email, status: 'Approved' }).toArray();
    res.send(result);
});
   // index.js
app.post('/create-checkout-session', async (req, res) => {
    const { applicationId, amount, tutorName, studentEmail } = req.body;
    
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'bdt',
                    unit_amount: parseInt(amount * 100), // Stripe uses cents
                    product_data: { name: `Hire Tutor: ${tutorName}` },
                },
                quantity: 1,
            }],
            mode: 'payment',
            customer_email: studentEmail,
            metadata: { applicationId: applicationId }, // Required for verify step
            success_url: `${process.env.SITE_DOMAIN}/dashboard/student/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.SITE_DOMAIN}/dashboard/student/payment-cancelled`,
        });
        res.send({ url: session.url });
    } catch (error) {
        console.error("Stripe Error:", error.message);
        res.status(500).send({ message: error.message });
    }
});

    // --- PAYMENT VERIFICATION & DB UPDATE ---
    app.patch('/payment-verify', async (req, res) => {
        const { session_id } = req.query;
        try {
            const session = await stripe.checkout.sessions.retrieve(session_id);
            if (session.payment_status === 'paid') {
                const appId = session.metadata.applicationId;
                
                //  Save Payment Record
                const payment = {
                    transactionId: session.payment_intent,
                    amount: session.amount_total / 100,
                    studentEmail: session.customer_email,
                    applicationId: appId,
                    date: new Date()
                };
                await paymentsCollection.insertOne(payment);

                //  Update Application Status
                const app = await applicationsCollection.findOneAndUpdate(
                    { _id: new ObjectId(appId) },
                    { $set: { status: 'Approved' } }
                );

                // Close Tuition Post
                if (app.value?.tuitionId) {
                    await tuitionsCollection.updateOne(
                        { _id: new ObjectId(app.value.tuitionId) },
                        { $set: { status: 'Closed' } }
                    );
                }
                res.send({ success: true });
            }
        } catch (error) {
            res.status(500).send({ message: "Verification failed" });
        }
    });
    // --- GET APPLICATIONS FOR STUDENT ---
    app.get('/applied-tutors/:email', async (req, res) => {
        const email = req.params.email;
        const result = await applicationsCollection.find({ studentEmail: email }).toArray();
        res.send(result);
    });
    
    const tuitionCount = await tuitionsCollection.countDocuments();
    if (tuitionCount === 0) {
       
        // await tuitionsCollection.insertMany(sampleTuitions);
        console.log("Skipped inserting sample tuition posts.");
    }
    
    const tutorCount = await tutorProfilesCollection.countDocuments();
    if (tutorCount === 0) {
 
        // await tutorProfilesCollection.insertMany(sampleTutors);
        console.log("Skipped inserting sample tutor profiles.");
    }
    
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
        
        const dbUser = await userCollection.findOne({ email: user.email });
        const userRole = dbUser ? dbUser.role : 'Student'; // Default to Student if role not found
        
        const payload = {
            email: user.email,
            role: userRole,
        };
        
        const token = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
        
        res.send({ token });
    });

    app.get('/all-tuitions', async (req, res) => {
    try {
        const allTuitions = await tuitionsCollection
            .find({})
            .sort({ createdAt: -1 }) 
            .toArray();
        res.send(allTuitions);
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch all tuitions" });
    }
});
     app.get('/tuition/:id', async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await tuitionsCollection.findOne(query);
    res.send(result);
});

app.get('/tutor/ongoing/:email', async (req, res) => {
    const email = req.params.email;
    const result = await applicationsCollection.find({ 
        tutorEmail: email, 
        status: 'Approved' 
    }).toArray();
    res.send(result);
});

app.get('/tutor/revenue/:email', async (req, res) => {
    const email = req.params.email;
  
    const payments = await paymentsCollection.aggregate([
        {
            $lookup: {
                from: 'applications',
                localField: 'applicationId',
                foreignField: '_id',
                as: 'appDetails'
            }
        },
        { $unwind: '$appDetails' },
        { $match: { 'appDetails.tutorEmail': email } }
    ]).toArray();
    res.send(payments);
});
    app.post('/latest-tuitions', async (req, res) => { 
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
    
    app.put('/tuition/:id', async (req, res) => {
        const id = req.params.id;
        const updatedPost = req.body;
    
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

    //  Delete a Tuition Post (DELETE)
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
    
    app.post('/latest-tutors', async (req, res) => { 
    
        const latestTutors = await tutorProfilesCollection
            .find({})
            .sort({ createdAt: -1 }) 
            .limit(3)
            .toArray();
        res.send(latestTutors);
    });


    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Tution is coming..')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})