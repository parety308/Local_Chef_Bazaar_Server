const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

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

        //user related api
        app.get('/users', async (req, res) => {
            const cursor = await userCollections.find().toArray();
            res.send(cursor);
        });

        app.post('/users', async (req, res) => {
            const user = req.body;
            const email = user.email;
            const exictingUser = await userCollections.findOne({ email });
            if (exictingUser) {
                return res.status(409).send({ message: 'User already exists' });
            }
            else {
                const result = await userCollections.insertOne(user);
                return res.send(result);
            }
        })

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
