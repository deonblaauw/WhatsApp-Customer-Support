require('dotenv').config();
const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');
const rateLimit = require('express-rate-limit');
const Queue = require('bull');
const Redis = require('ioredis');
const fs = require('fs').promises;
const path = require('path');

const app = express();

// Trust proxy settings for running behind ngrok
app.set('trust proxy', 1);

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

app.use(limiter);

// Initialize Redis
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
});

// Initialize message queue
const messageQueue = new Queue('whatsapp-messages', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
});

// Initialize OpenAI with retry mechanism
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// WhatsApp API Configuration
const WHATSAPP_API_VERSION = 'v22.0';
const WHATSAPP_API_URL = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

// Message rate limiting
const MESSAGE_WINDOW_MS = 1000; // 1 second
const MAX_MESSAGES_PER_WINDOW = 30; // WhatsApp business limit
let messagesSentInWindow = 0;
let windowStart = Date.now();

// Constants for token management
const MAX_TOKENS = 120000; // Keep well below 128k limit
const CONVERSATION_TTL = 24 * 60 * 60; // 24 hours in seconds

// Function to load support script
async function loadSupportScript() {
  try {
    const scriptPath = path.join(__dirname, 'support_script.txt');
    const scriptContent = await fs.readFile(scriptPath, 'utf8');
    return {
      role: "system",
      content: `${scriptContent}\n\nIMPORTANT: Keep all responses brief and concise. Aim for 2-3 sentences when possible. Only provide detailed explanations when absolutely necessary for technical support or safety-related issues.`
    };
  } catch (error) {
    console.error('Error loading support script:', error);
    throw error;
  }
}

// Function to send WhatsApp message with rate limiting
async function sendWhatsAppMessage(to, message, retryCount = 0) {
  try {
    // Rate limiting check
    const now = Date.now();
    if (now - windowStart > MESSAGE_WINDOW_MS) {
      messagesSentInWindow = 0;
      windowStart = now;
    }

    if (messagesSentInWindow >= MAX_MESSAGES_PER_WINDOW) {
      const delayMs = MESSAGE_WINDOW_MS - (now - windowStart);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return sendWhatsAppMessage(to, message, retryCount);
    }

    messagesSentInWindow++;

    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "text",
        text: { 
          body: message
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    await redis.set(`last_message:${to}`, message);
    await redis.expire(`last_message:${to}`, 3600); // expire after 1 hour
    
    console.log('Message sent successfully:', response.data);
    return response.data;
  } catch (error) {
    if (error.response?.data?.error?.code === 131030) {
      console.error(`Error: Phone number ${to} is not in the allowed recipients list. Please add it in the Meta Developer Console.`);
      throw new Error(`Recipient ${to} not authorized. Add the number to your test contacts in Meta Developer Console.`);
    }
    
    console.error('Error sending message:', error.response?.data || error.message);
    
    if (retryCount < 3 && error.response?.status >= 500) {
      const delay = Math.pow(2, retryCount) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return sendWhatsAppMessage(to, message, retryCount + 1);
    }
    
    throw error;
  }
}

// Process messages from queue
messageQueue.process(async (job) => {
  const { to, message } = job.data;
  await sendWhatsAppMessage(to, message);
});

// Monitor queue errors
messageQueue.on('error', (error) => {
  console.error('Queue error:', error);
});

messageQueue.on('failed', (job, error) => {
  console.error('Job failed:', job.id, error);
});

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'WhatsApp bot server is running',
    queueStats: {
      waiting: messageQueue.getWaiting(),
      active: messageQueue.getActive(),
      completed: messageQueue.getCompleted(),
      failed: messageQueue.getFailed()
    }
  });
});

// Webhook verification endpoint
app.get('/webhook', (req, res) => {
  console.log('Received webhook verification request:', req.query);
  
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!mode || !token) {
    console.log('Missing mode or token');
    return res.sendStatus(400);
  }

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    return res.status(200).send(challenge);
  } else {
    console.log('Verification failed');
    return res.sendStatus(403);
  }
});

// Function to get conversation history
async function getConversationHistory(userId) {
  const historyKey = `chat_history:${userId}`;
  const tokenCountKey = `token_count:${userId}`;
  
  try {
    const history = await redis.get(historyKey);
    const tokenCount = await redis.get(tokenCountKey);
    
    return {
      messages: history ? JSON.parse(history) : [],
      tokenCount: tokenCount ? parseInt(tokenCount) : 0
    };
  } catch (error) {
    console.error('Error getting conversation history:', error);
    return { messages: [], tokenCount: 0 };
  }
}

// Function to update conversation history
async function updateConversationHistory(userId, newMessages, tokenUsage) {
  const historyKey = `chat_history:${userId}`;
  const tokenCountKey = `token_count:${userId}`;
  
  try {
    const { messages, tokenCount } = await getConversationHistory(userId);
    const updatedMessages = [...messages, ...newMessages];
    const updatedTokenCount = tokenCount + tokenUsage;
    
    // Store updated history and token count
    await redis.set(historyKey, JSON.stringify(updatedMessages), 'EX', CONVERSATION_TTL);
    await redis.set(tokenCountKey, updatedTokenCount, 'EX', CONVERSATION_TTL);
    
    return {
      messages: updatedMessages,
      tokenCount: updatedTokenCount
    };
  } catch (error) {
    console.error('Error updating conversation history:', error);
    throw error;
  }
}

// Function to get AI response with conversation history
async function getAIResponse(userMessage, userId) {
  const cacheKey = `ai_response:${userMessage}`;
  
  try {
    // Try to get cached response
    const cachedResponse = await redis.get(cacheKey);
    if (cachedResponse) {
      try {
        const parsed = JSON.parse(cachedResponse);
        return parsed;
      } catch (parseError) {
        console.warn('Error parsing cached response:', parseError);
      }
    }

    // Get conversation history and support script
    const [{ messages: historyMessages, tokenCount }, supportScript] = await Promise.all([
      getConversationHistory(userId),
      loadSupportScript()
    ]);
    
    // Prepare messages array with support script and history
    const messageArray = [
      supportScript,
      ...historyMessages,
      {
        role: "user",
        content: userMessage
      }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: messageArray,
      max_tokens: 2000,
      temperature: 0.7
    });

    const response = completion.choices[0].message.content;
    const usage = completion.usage;
    
    // Update conversation history with new messages and token count
    const newMessages = [
      { role: "user", content: userMessage },
      { role: "assistant", content: response }
    ];
    
    await updateConversationHistory(userId, newMessages, usage.total_tokens);
    
    // Cache the response with token usage
    const responseData = {
      content: response,
      usage: usage
    };

    // Ensure we're storing valid JSON
    await redis.set(cacheKey, JSON.stringify(responseData), 'EX', 3600);
    
    return responseData;
  } catch (error) {
    console.error('Error getting AI response:', error);
    return {
      content: "I apologize, but I'm having trouble accessing our support system right now. Please try again in a few moments.",
      usage: { total_tokens: 0 }
    };
  }
}

// Message processing worker with conversation history
messageQueue.process('process_message', async (job) => {
  const { from, messageText } = job.data;
  
  try {
    console.log('Processing message from queue:', { from, messageText });
    const aiResponse = await getAIResponse(messageText, from);
    console.log('Got AI response:', aiResponse);
    
    // Send the response directly
    await sendWhatsAppMessage(from, aiResponse.content);
    console.log('Response sent successfully');
    
    // Log token usage
    console.log('Token usage for this interaction:', aiResponse.usage);
    
    return { 
      success: true, 
      from, 
      messageText, 
      aiResponse: aiResponse.content,
      tokenUsage: aiResponse.usage
    };
  } catch (error) {
    console.error('Error processing message:', error);
    throw error;
  }
});

// Webhook for receiving messages with queue
app.post('/webhook', async (req, res) => {
  try {
    const data = req.body;

    if (data.object === 'whatsapp_business_account') {
      for (const entry of data.entry) {
        for (const change of entry.changes) {
          if (change.value.messages) {
            for (const message of change.value.messages) {
              const from = message.from;
              const messageText = message.text?.body;

              if (messageText) {
                console.log('Adding message to queue:', { from, messageText });
                // Add message processing to queue
                await messageQueue.add('process_message', {
                  from,
                  messageText,
                  timestamp: Date.now()
                }, {
                  attempts: 3,
                  backoff: {
                    type: 'exponential',
                    delay: 2000
                  }
                });
              }
            }
          }
        }
      }
    }

    // Respond immediately to webhook
    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.sendStatus(500);
  }
});

// Add token usage monitoring endpoint
app.get('/stats', async (req, res) => {
  try {
    const stats = {
      status: 'ok',
      queueStats: {
        waiting: await messageQueue.getWaiting(),
        active: await messageQueue.getActive(),
        completed: await messageQueue.getCompleted(),
        failed: await messageQueue.getFailed()
      },
      activeConversations: 0,
      totalTokensUsed: 0
    };

    // Get all token count keys
    const tokenKeys = await redis.keys('token_count:*');
    stats.activeConversations = tokenKeys.length;
    
    // Sum up total tokens used
    for (const key of tokenKeys) {
      const count = await redis.get(key);
      stats.totalTokensUsed += parseInt(count || 0);
    }

    res.status(200).json(stats);
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Development endpoint to clear Redis
app.post('/dev/clear-redis', async (req, res) => {
  try {
    await redis.flushall();
    res.json({ status: 'ok', message: 'Redis cleared successfully' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Start server with port fallback and graceful shutdown
const startServer = async (initialPort) => {
  const tryPort = async (port) => {
    try {
      const server = app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
      });

      // Graceful shutdown
      process.on('SIGTERM', async () => {
        console.log('SIGTERM received. Starting graceful shutdown...');
        
        // Stop accepting new requests
        server.close(async () => {
          console.log('HTTP server closed');
          
          // Wait for existing jobs to complete
          await messageQueue.pause(true);
          await messageQueue.close();
          
          // Close Redis connection
          await redis.quit();
          
          console.log('Graceful shutdown completed');
          process.exit(0);
        });
      });

    } catch (error) {
      if (error.code === 'EADDRINUSE') {
        console.log(`Port ${port} is busy, trying ${port + 1}...`);
        await tryPort(port + 1);
      } else {
        console.error('Failed to start server:', error);
        process.exit(1);
      }
    }
  };

  await tryPort(initialPort);
};

// Start the server
startServer(process.env.PORT || 3000); 