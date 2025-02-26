# WhatsApp Customer Service Bot

A scalable WhatsApp bot that uses AI to provide customer service for ScannerEdge, built with Node.js, Express, Redis, and OpenAI's GPT-4.

## Features

- 🤖 AI-powered responses using GPT-4
- 💬 WhatsApp message handling via Meta's Cloud API
- 🔄 Message queuing with automatic retries
- ⚡ Rate limiting for API protection
- 💾 Conversation history management
- 📊 Token usage tracking
- 🚀 Horizontal scaling support
- 🔒 Secure environment configuration

## Prerequisites

- Node.js v16 or higher
- Redis server
- Meta Developer Account
- WhatsApp Business API access
- OpenAI API key

## Installation

1. Clone the repository:
   ```bash
   git clone <your-repo-url>
   cd whatsapp-customer-bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables in `.env`:
   ```env
   # Server Configuration
   PORT=3000
   
   # WhatsApp API Configuration
   WHATSAPP_TOKEN=your_whatsapp_token
   WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
   VERIFY_TOKEN=your_webhook_verify_token
   
   # OpenAI Configuration
   OPENAI_API_KEY=your_openai_api_key
   
   # Redis Configuration (optional)
   REDIS_HOST=localhost
   REDIS_PORT=6379
   ```

## Setup WhatsApp Business API

1. Create a Meta Developer account at https://developers.facebook.com
2. Set up a WhatsApp Business App
3. Configure your webhook:
   - URL: `https://your-domain/webhook`
   - Verify Token: Same as `VERIFY_TOKEN` in `.env`
4. Add test phone numbers in Meta Developer Console

## Running the Bot

1. Start Redis server:
   ```bash
   redis-server
   ```

2. Start the application:
   ```bash
   node src/server.js
   ```

3. Set up ngrok for local development:
   ```bash
   ngrok http 3000
   ```

4. Update webhook URL in Meta Developer Console with ngrok URL

## Architecture

The bot uses a scalable architecture with the following components:

- Express server for webhook handling
- Bull queue backed by Redis for message processing
- Rate limiting for API protection
- Redis for caching and conversation management
- OpenAI GPT-4 for generating responses

## API Endpoints

- `GET /` - Health check and queue statistics
- `GET /webhook` - WhatsApp webhook verification
- `POST /webhook` - WhatsApp message handling
- `GET /stats` - Usage statistics and monitoring

## Monitoring

Monitor the bot's performance using the `/stats` endpoint, which provides:
- Queue statistics
- Active conversations
- Total tokens used
- Message processing status

## Error Handling

The bot includes comprehensive error handling for:
- Rate limiting
- API failures
- Message processing errors
- Invalid phone numbers
- Token usage limits

## Development

To contribute or modify:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Production Deployment

For production:

1. Set up a production Redis instance
2. Configure environment variables
3. Use PM2 or similar for process management:
   ```bash
   npm install -g pm2
   pm2 start src/server.js
   ```

## Security Considerations

- Store environment variables securely
- Use rate limiting
- Implement IP whitelisting
- Regular security audits
- Monitor token usage

## Limitations

- WhatsApp Business API restrictions
- GPT-4 token limits (120k)
- Rate limiting constraints
- Test phone number requirements

## Troubleshooting

Common issues and solutions:

1. **Webhook Verification Failed**
   - Check `VERIFY_TOKEN` matches Meta Console
   - Ensure webhook URL is accessible

2. **Message Sending Failed**
   - Verify phone number is in allowed list
   - Check WhatsApp token validity
   - Monitor rate limits

3. **Redis Connection Issues**
   - Confirm Redis is running
   - Check connection settings

## License

[Your License Type] - See LICENSE file for details

## Support

For support:
- Create an issue
- Check existing documentation
- Contact [your contact information]

## Customer Support Configuration

The bot uses a customizable support script located in `src/support_script.txt`. This script defines:

- AI persona and behavior
- Product specifications
- Response guidelines
- Support limitations

### Modifying the Support Script

1. Edit `src/support_script.txt` to customize:
   - Support agent behavior
   - Product information
   - Standard responses
   - Support rules

2. The script format should maintain:
   - Clear sections (RULES, SPECIFICATIONS, etc.)
   - Professional tone
   - Explicit instructions
   - Product accuracy

### Product Information

ScannerEdge specifications supported by the bot:
- Detection Range: Up to 3km for mobile/satellite phones and walkie talkies
- Configuration: Bluetooth with smartphone app
- Tracking: GPS position tracking
- Connectivity: LoRaWAN or satellite
- Monitoring: Remote device monitoring
- Build: Ruggedized for outdoor conditions
- Power: Solar powered (5-30 Volt DC)
- Compliance: Follows all regulations
- Privacy: No personal data collection
- Integration: Compatible with park management tools

### Script Reloading

The support script is loaded dynamically for each conversation, allowing you to:
- Update product information without restart
- Modify support protocols in real-time
- Adjust response templates as needed
- Fine-tune the AI's behavior 