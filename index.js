const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express()
const port = process.env.PORT;

//middleware
app.use(express.json());
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));

// app.use()

const uri = process.env.URI;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();

        const db = client.db('local_chef_bazaar_data');
        const userCollections = db.collection('users');
        const mealCollections = db.collection('meals');
        const reviewCollections = db.collection('reviews');
        const favouriteCollections = db.collection('favourites');
        const userRequestCollection = db.collection('users-request');

        //user related api
        app.get('/users', async (req, res) => {
            const cursor = await userCollections.find().toArray();
            res.send(cursor);
        });
        app.get('/users-role/:email', async (req, res) => {
            const email = req.params.email;
            const result = await userCollections.findOne({ email });
            res.send(result);
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const email = user.email;
            user.role = 'user';
            const exictingUser = await userCollections.findOne({ email });
            if (exictingUser) {
                return res.status(409).send({ message: 'User already exists' });
            }
            else {
                const result = await userCollections.insertOne(user);
                return res.send(result);
            }
        });

        //user-request related apis
        app.get('/users-request', async (req, res) => {
            const result = await userRequestCollection.find().toArray();
            res.send(result);
        });
        app.post('/users-request', async (req, res) => {
            const userRequest = req.body;
            const result = await userRequestCollection.insertOne(userRequest);
            res.send(result);

        });
        app.patch('/users-request/:userEmail', async (req, res) => {
           
        })

        //meals related api
        app.get('/meals', async (req, res) => {
            const result = await mealCollections.find().toArray();
            res.send(result);
        });
        app.get('/meals/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const result = await mealCollections.findOne(query);
                res.send(result);
            }
            catch (error) {
                res.status(500).send({ message: 'Server error', error: error.message });
            }
        });

        //review related apis 
        app.get('/reviews/:mealId', async (req, res) => {
            const mealId = req.params.mealId;
            const query = { mealId };
            const result = await reviewCollections.find(query).toArray();
            res.send(result);
        });

        app.get('/myreviews/:userEmail', async (req, res) => {
            const userEmail = req.params.userEmail;
            console.log(userEmail)
            if (!userEmail) {
                return res.status(400).send({ message: "User is required" });
            }
            else {
                const query = { userEmail };
                const result = await reviewCollections.find(query).toArray();
                return res.send(result);
            }
        });

        app.post('/reviews', async (req, res) => {
            const review = req.body;
            review.date = new Date();
            const result = await reviewCollections.insertOne(review);
            res.send(result);
        });

        //favourite related apis 
        app.get('/favourites/:userEmail', async (req, res) => {
            const userEmail = req.params.userEmail;
            const query = { userEmail };
            const result = await favouriteCollections.find(query).toArray();
            res.send(result);
        });
        app.post('/favourites', async (req, res) => {
            const favourite = req.body;
            const mealId = req.body.mealId;
            // console.log(mealId);
            const exictingFav = await favouriteCollections.findOne({ mealId });
            if (exictingFav) {
                return res.status(400).send({ message: "Already exists" });
            }
            else {
                favourite.added_date = new Date();
                const result = await favouriteCollections.insertOne(favourite);
                return res.send(result);
            }
        });

        app.delete('/favourites/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await favouriteCollections.deleteOne(query);
            res.send(result);

        });


        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
    }
}


app.get('/', (req, res) => {
    res.send('Local Chef Bazaar Backend is Running')
})

run().catch(console.dir);

app.listen(port, () => {
    console.log(`Local Chef Bazaar app listening on port ${port}`)
})
