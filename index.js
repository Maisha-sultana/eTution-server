const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
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

// Global collections
let userCollection;
let tuitionsCollection;
let tutorProfilesCollection;
let applicationsCollection;
let paymentsCollection;

// Database connection
async function connectDB() {
  try {
    await client.connect();
    const db = client.db('tution_db');
    userCollection = db.collection('users');
    tuitionsCollection = db.collection('tuitions');
    tutorProfilesCollection = db.collection('tutorProfiles');
    applicationsCollection = db.collection('applications');
    paymentsCollection = db.collection('payments');
    
    console.log("✅ Successfully connected to MongoDB!");
    return true;
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    return false;
  }
}

// Middleware to check DB connection
const checkDBConnection = (req, res, next) => {
  if (!userCollection) {
    return res.status(503).send({ message: "Database not connected" });
  }
  next();
};

// Health check route (no DB needed)
app.get('/', (req, res) => {
  res.send('Tution server is running...');
});

app.get('/health', (req, res) => {
  res.send({ 
    status: 'ok', 
    dbConnected: !!userCollection,
    timestamp: new Date().toISOString()
  });
});

app.use('/api', checkDBConnection);

// ============ TUTOR ROUTES ============
app.get('/tutor/revenue/:email', checkDBConnection, async (req, res) => {
  const email = req.params.email;
  try {
    const payments = await paymentsCollection.aggregate([
      { $addFields: { appIdObj: { $toObjectId: "$applicationId" } } },
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
    console.error("Revenue fetch error:", error);
    res.status(500).send({ message: "Failed to fetch revenue" });
  }
});

app.get('/tutor/ongoing/:email', checkDBConnection, async (req, res) => {
  const email = req.params.email;
  try {
    const result = await applicationsCollection.find({ 
      tutorEmail: email, 
      status: 'Approved' 
    }).toArray();
    res.send(result);
  } catch (error) {
    console.error("Ongoing tuitions error:", error);
    res.status(500).send({ message: "Failed to fetch ongoing tuitions" });
  }
});

app.get('/tutor-profile/:email', checkDBConnection, async (req, res) => {
  const email = req.params.email;
  try {
    const result = await tutorProfilesCollection.findOne({ tutorEmail: email });
    res.send(result || {});
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).send({ message: "Error fetching profile" });
  }
});

app.patch('/tutor-profile-update', checkDBConnection, async (req, res) => {
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
    $setOnInsert: {
        createdAt: new Date() 
      }
  };
  
  try {
    const result = await tutorProfilesCollection.updateOne(filter, updateDoc, options);
    res.send(result);
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).send({ message: "Failed to update profile" });
  }
});

app.get('/all-tutors', checkDBConnection, async (req, res) => {
  try {
    const result = await tutorProfilesCollection.find().toArray();
    res.send(result);
  } catch (error) {
    console.error("Fetch tutors error:", error);
    res.status(500).send({ message: "Failed to fetch tutors" });
  }
});

app.post('/latest-tutors', checkDBConnection, async (req, res) => {
  try {
    const latestTutors = await tutorProfilesCollection
      .find({})
      .sort({ createdAt: -1 })
      .limit(3)
      .toArray();
    res.send(latestTutors);
  } catch (error) {
    console.error("Latest tutors error:", error);
    res.status(500).send({ message: "Failed to fetch latest tutors" });
  }
});

// ============ STUDENT ROUTES ============
app.get('/student-profile/:email', checkDBConnection, async (req, res) => {
  const email = req.params.email;
  try {
    const result = await userCollection.findOne({ email: email });
    res.send(result || {});
  } catch (error) {
    console.error("Student profile error:", error);
    res.status(500).send({ message: "Error fetching student profile" });
  }
});

app.patch('/student-profile-update', checkDBConnection, async (req, res) => {
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
    console.error("Student profile update error:", error);
    res.status(500).send({ message: "Update failed" });
  }
});

app.get('/applied-tutors/:email', checkDBConnection, async (req, res) => {
  const email = req.params.email;
  try {
    const result = await applicationsCollection.find({ studentEmail: email }).toArray();
    res.send(result);
  } catch (error) {
    console.error("Applied tutors error:", error);
    res.status(500).send({ message: "Failed to fetch applications" });
  }
});

// ============ TUITION ROUTES ============
app.get('/all-tuitions', checkDBConnection, async (req, res) => {
  try {
    const { search, class: classFilter, location, sort, page = 1, limit = 6 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    let query = { status: 'Approved' }; 

    // Search by Subject
    if (search) {
      query.subject = { $regex: search, $options: 'i' };
    }

    if (classFilter) {
      query.classLevel = { $regex: classFilter, $options: 'i' };
    }

    if (location) {
      query.location = { $regex: location, $options: 'i' };
    }

    let sortOption = { createdAt: -1 }; 
    if (sort === 'salaryLow') {
      sortOption = { salary: 1 };
    } else if (sort === 'salaryHigh') {
      sortOption = { salary: -1 };
    }

    const result = await tuitionsCollection.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();
      
    const total = await tuitionsCollection.countDocuments(query);
    res.send({ result, total });
  } catch (error) {
    res.status(500).send({ message: "Fetch error" });
  }
});
app.post('/latest-tuitions', checkDBConnection, async (req, res) => {
  try {
    const latestTuitions = await tuitionsCollection
      .find({ status: 'Approved' }) 
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();
    res.send(latestTuitions);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch latest tuitions" });
  }
});

app.get('/tuition/:id', checkDBConnection, async (req, res) => {
  const id = req.params.id;
  try {
    const query = { _id: new ObjectId(id) };
    const result = await tuitionsCollection.findOne(query);
    if (!result) {
      return res.status(404).send({ message: "Tuition not found" });
    }
    res.send(result);
  } catch (error) {
    console.error("Tuition fetch error:", error);
    res.status(500).send({ message: "Failed to fetch tuition" });
  }
});

app.post('/tuition', checkDBConnection, async (req, res) => {
  const post = req.body;
  if (!post.studentEmail || !post.subject) {
    return res.status(400).send({ message: "Missing required fields." });
  }
  
  const tuitionPost = {
    ...post,
    createdAt: new Date(),
    status: 'Pending',
  };
  
  try {
    const result = await tuitionsCollection.insertOne(tuitionPost);
    res.send({ 
      acknowledged: true, 
      insertedId: result.insertedId, 
      message: "Tuition post submitted successfully." 
    });
  } catch (error) {
    console.error("Error posting tuition:", error);
    res.status(500).send({ message: "Failed to post tuition." });
  }
});

app.post('/my-tuitions', checkDBConnection, async (req, res) => {
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

app.put('/tuition/:id', checkDBConnection, async (req, res) => {
  const id = req.params.id;
  const updatedPost = req.body;
  const { _id, studentEmail, createdAt, ...updateDoc } = updatedPost;
  const filter = { _id: new ObjectId(id) };
  const updateOperation = { $set: updateDoc };
  
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

app.delete('/tuition/:id', checkDBConnection, async (req, res) => {
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

// ============ APPLICATION ROUTES ============
app.post('/applications', checkDBConnection, async (req, res) => {
  const application = req.body;
  const query = { 
    tuitionId: application.tuitionId, 
    tutorEmail: application.tutorEmail 
  };
  
  try {
    const existing = await applicationsCollection.findOne(query);
    if (existing) {
      return res.status(400).send({ message: "Already applied!" });
    }
    
    const result = await applicationsCollection.insertOne({ 
      ...application, 
      status: 'Pending', 
      appliedAt: new Date() 
    });
    res.send(result);
  } catch (error) {
    console.error("Application error:", error);
    res.status(500).send({ message: "Failed to submit application" });
  }
});

app.get('/tutor-applications/:email', checkDBConnection, async (req, res) => {
  const email = req.params.email;
  try {
    const result = await applicationsCollection.find({ tutorEmail: email }).toArray();
    res.send(result);
  } catch (error) {
    console.error("Tutor applications error:", error);
    res.status(500).send({ message: "Failed to fetch applications" });
  }
});

app.delete('/application-cancel/:id', checkDBConnection, async (req, res) => {
  const id = req.params.id;
  try {
    const result = await applicationsCollection.deleteOne({ 
      _id: new ObjectId(id), 
      status: 'Pending' 
    });
    res.send(result);
  } catch (error) {
    console.error("Cancel application error:", error);
    res.status(500).send({ message: "Failed to cancel application" });
  }
});

// ============ PAYMENT ROUTES ============
app.post('/create-checkout-session', checkDBConnection, async (req, res) => {
  const { applicationId, amount, tutorName, studentEmail } = req.body;
  
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'bdt',
          unit_amount: parseInt(amount * 100),
          product_data: {
            name: `Hire Tutor: ${tutorName}`
          },
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: studentEmail,
      metadata: { applicationId: applicationId },
      success_url: `${process.env.SITE_DOMAIN}/dashboard/student/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}/dashboard/student/payment-cancelled`,
    });
    
    res.send({ url: session.url });
  } catch (error) {
    console.error("Stripe Error:", error.message);
    res.status(500).send({ message: error.message });
  }
});

app.patch('/payment-verify', checkDBConnection, async (req, res) => {
  const { session_id } = req.query;
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    
    if (session.payment_status === 'paid') {
      const appId = session.metadata.applicationId;
      
      const paymentInfo = {
        applicationId: appId,
        transactionId: session.payment_intent, 
        amount: session.amount_total / 100, 
        studentEmail: session.customer_email,
        date: new Date(),
        status: 'success'
      };

      await paymentsCollection.insertOne(paymentInfo);

      const updatedApp = await applicationsCollection.findOneAndUpdate(
        { _id: new ObjectId(appId) },
        { $set: { status: 'Approved' } },
        { returnDocument: 'after' }
      );

      if (updatedApp.value?.tuitionId) {
        await tuitionsCollection.updateOne(
          { _id: new ObjectId(updatedApp.value.tuitionId) },
          { $set: { status: 'Closed' } }
        );
      }
      
      res.send({ success: true });
    } else {
      res.send({ success: false, message: "Payment not paid" });
    }
  } catch (error) {
    console.error("Payment Verify Error:", error);
    res.status(500).send({ success: false });
  }
});
// ============ ADMIN ROUTES ============
app.get('/admin/all-tuitions', checkDBConnection, async (req, res) => {
  try {
    const result = await tuitionsCollection.find().sort({ createdAt: -1 }).toArray();
    res.send(result);
  } catch (error) {
    console.error("Admin tuitions error:", error);
    res.status(500).send({ message: "Failed to fetch tuitions" });
  }
});

app.patch('/admin/tuition-status/:id', checkDBConnection, async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  
  try {
    const result = await tuitionsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: status } }
    );
    res.send(result);
  } catch (error) {
    console.error("Status update error:", error);
    res.status(500).send({ message: "Failed to update status" });
  }
});

app.get('/admin/stats', checkDBConnection, async (req, res) => {
  try {
    const totalEarnings = await paymentsCollection.aggregate([
      { $group: { _id: null, total: { $sum: { $toDouble: "$amount" } } } }
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
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).send({ message: "Failed to fetch stats" });
  }
});

// ============ USER ROUTES ============
app.get('/users', checkDBConnection, async (req, res) => {
  try {
    const result = await userCollection.find().toArray();
    res.send(result);
  } catch (error) {
    console.error("Users fetch error:", error);
    res.status(500).send({ message: "Failed to fetch users" });
  }
});

app.post('/users', checkDBConnection, async (req, res) => {
  const user = req.body;
  const query = { email: user.email };
  
  try {
    const existingUser = await userCollection.findOne(query);
    if (existingUser) {
      return res.send({ message: 'User already exists in DB', insertedId: null });
    }
    const result = await userCollection.insertOne(user);
    res.send(result);
  } catch (error) {
    console.error("User creation error:", error);
    res.status(500).send({ message: "Failed to create user" });
  }
});

app.patch('/users/role/:id', checkDBConnection, async (req, res) => {
    const id = req.params.id;
    const { role } = req.body;
    const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role: role } }
    );
    res.send(result);
});

app.patch('/users/:id', checkDBConnection, async (req, res) => {
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
  
  try {
    const result = await userCollection.updateOne(filter, updateDoc);
    res.send(result);
  } catch (error) {
    console.error("User update error:", error);
    res.status(500).send({ message: "Failed to update user" });
  }
});

app.delete('/users/:id', checkDBConnection, async (req, res) => {
  const id = req.params.id;
  try {
    const result = await userCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (error) {
    console.error("User delete error:", error);
    res.status(500).send({ message: "Failed to delete user" });
  }
});

// ============ JWT ROUTE ============
app.post('/jwt', checkDBConnection, async (req, res) => {
  const user = req.body;
  
  try {
    const dbUser = await userCollection.findOne({ email: user.email });
    const userRole = dbUser ? dbUser.role : 'Student';
    
    const payload = {
      email: user.email,
      role: userRole,
    };
    
    const token = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
    res.send({ token });
  } catch (error) {
    console.error("JWT error:", error);
    res.status(500).send({ message: "Failed to generate token" });
  }
});
const verifyToken = (req, res, next) => {
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized access' });
                }
                req.decoded = decoded;
                next();
            });
        };

        // 2. Verify Admin (Security)
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const user = await userCollection.findOne({ email });
            if (user?.role !== 'Admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        };

// ============ 404 HANDLER ============
app.use((req, res) => {
  res.status(404).send({ 
    message: "Route not found", 
    path: req.path,
    method: req.method 
  });
});

// ============ ERROR HANDLER ============
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).send({ 
    message: "Internal server error", 
    error: process.env.NODE_ENV === 'development' ? err.message : undefined 
  });
});

// ============ START SERVER ============
async function startServer() {
  const dbConnected = await connectDB();
  
  if (!dbConnected) {
    console.error("Failed to connect to database. Server will start but routes will return 503.");
  }
  
  app.listen(port, () => {
    console.log(` Server listening on port ${port}`);
  });
}

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await client.close();
  process.exit(0);
});