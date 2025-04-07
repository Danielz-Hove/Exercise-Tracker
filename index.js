const express = require('express');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser'); // To parse POST request bodies
const mongoose = require('mongoose');
require('dotenv').config();

// --- Database Connection ---
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Database connected successfully"))
  .catch(err => console.error("Database connection error:", err));

// --- Mongoose Schemas ---
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true } // Added unique constraint for clarity
});
const User = mongoose.model('User', userSchema);

const exerciseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  description: { type: String, required: true },
  duration: { type: Number, required: true },
  date: { type: Date, default: Date.now }
});
const Exercise = mongoose.model('Exercise', exerciseSchema);

// --- Middleware ---
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false })); // Parse application/x-www-form-urlencoded
app.use(express.static('public'));

// --- Routes ---
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html');
});

// 2. POST /api/users - Create a new user
app.post('/api/users', async (req, res) => {
  const username = req.body.username;
  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    // Check if user already exists (optional, but good practice)
    let foundUser = await User.findOne({ username: username });
    if (foundUser) {
      // If user exists, return existing user data
      return res.json({ username: foundUser.username, _id: foundUser._id });
    }

    // Create and save new user
    const newUser = new User({ username: username });
    const savedUser = await newUser.save();
    // 3. Return new user object
    res.json({ username: savedUser.username, _id: savedUser._id });
  } catch (err) {
    console.error("Error creating user:", err);
    // Handle potential errors like duplicate key if unique constraint is violated
    if (err.code === 11000) {
       return res.status(400).json({ error: "Username already taken" });
    }
    res.status(500).json({ error: "Could not create user" });
  }
});

// 4. GET /api/users - Get a list of all users
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username _id'); // Select only username and _id
    // 5. & 6. Return array of user objects
    res.json(users);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Could not retrieve users" });
  }
});

// 7. POST /api/users/:_id/exercises - Add an exercise
app.post('/api/users/:_id/exercises', async (req, res) => {
  const userId = req.params._id;
  const { description, duration } = req.body;
  let date = req.body.date;

  if (!description || !duration) {
    return res.status(400).json({ error: "Description and duration are required" });
  }

  // Validate and parse duration
  const durationNum = parseInt(duration);
  if (isNaN(durationNum)) {
     return res.status(400).json({ error: "Duration must be a number" });
  }

  // Validate and parse date
  let exerciseDate;
  if (!date) {
    exerciseDate = new Date(); // Use current date if not provided
  } else {
    exerciseDate = new Date(date);
    if (isNaN(exerciseDate.getTime())) { // Check if the parsed date is valid
      return res.status(400).json({ error: "Invalid date format" });
    }
  }

  try {
    // Find the user first
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Create and save the new exercise
    const newExercise = new Exercise({
      userId: user._id,
      description: description,
      duration: durationNum,
      date: exerciseDate
    });
    const savedExercise = await newExercise.save();

    // 8. Return the user object with exercise fields added
    res.json({
      username: user.username,
      description: savedExercise.description,
      duration: savedExercise.duration,
      date: savedExercise.date.toDateString(), // Format date as required
      _id: user._id
    });

  } catch (err) {
    console.error("Error adding exercise:", err);
     // Check for potential CastError if _id format is wrong
    if (err.name === 'CastError' && err.path === '_id') {
        return res.status(400).json({ error: "Invalid user ID format" });
    }
    res.status(500).json({ error: "Could not add exercise" });
  }
});

// 9. GET /api/users/:_id/logs - Retrieve a user's exercise log
app.get('/api/users/:_id/logs', async (req, res) => {
  const userId = req.params._id;
  const { from, to, limit } = req.query;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Build the query for exercises
    let query = Exercise.find({ userId: userId }).select('description duration date'); // Select only needed fields

    // Apply date filters (16)
    let dateFilter = {};
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        dateFilter.$gte = fromDate;
      } else {
        return res.status(400).json({error: "Invalid 'from' date format"});
      }
    }
    if (to) {
      const toDate = new Date(to);
       if (!isNaN(toDate.getTime())) {
        dateFilter.$lte = toDate;
      } else {
          return res.status(400).json({error: "Invalid 'to' date format"});
      }
    }
    if (Object.keys(dateFilter).length > 0) {
       query = query.where('date', dateFilter);
    }


    // Apply limit filter (16)
    const limitNum = parseInt(limit);
    if (!isNaN(limitNum) && limitNum > 0) {
      query = query.limit(limitNum);
    }

    const exercises = await query.exec();

    // 11. Format the log array
    const log = exercises.map(ex => ({
      description: ex.description, // 12, 13 (string)
      duration: ex.duration,       // 12, 14 (number)
      date: ex.date.toDateString() // 12, 15 (string - dateString format)
    }));

    // 10. Return user object with count and log
    res.json({
      username: user.username,
      count: log.length, // Count reflects the number of exercises *returned* in the log
      _id: user._id,
      log: log
    });

  } catch (err) {
    console.error("Error fetching logs:", err);
    // Check for potential CastError if _id format is wrong
    if (err.name === 'CastError' && err.path === '_id') {
        return res.status(400).json({ error: "Invalid user ID format" });
    }
    res.status(500).json({ error: "Could not retrieve logs" });
  }
});


// --- Listener ---
const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port);
});
