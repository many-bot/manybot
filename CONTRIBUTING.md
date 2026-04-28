# Contributing to ManyBot

Thank you for considering contributing to ManyBot! This document provides guidelines and instructions for contributing to the project.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Plugin Development](#plugin-development)
- [Reporting Issues](#reporting-issues)
- [Testing](#testing)
- [Documentation](#documentation)

---

## Code of Conduct

- Be respectful and inclusive in all interactions
- Focus on constructive feedback and collaboration
- Keep discussions on-topic and professional
- Harassment or discriminatory behavior will not be tolerated

---

## Getting Started

### Prerequisites

- **Node.js** v18 or higher
- **npm** v9 or higher
- **Git** for version control
- **WhatsApp** account for testing

### First-Time Setup

```bash
# Clone the repository
git clone https://git.maneos.net/synt-xerror/manybot
cd manybot

# Install dependencies
npm install

# Copy configuration template
cp manybot.conf.example manybot.conf

# Edit configuration
nano manybot.conf

# Run setup script
bash ./setup
```

---

## Development Setup

### Running in Development

```bash
# Start the bot
node src/main.js

# Or with logging
journalctl -u manybot -f  # If installed as systemd service
```

### Debugging

```bash
# Enable verbose logging
node --inspect src/main.js

# Run setup with debug output
bash -x ./setup
```

### Environment Considerations

ManyBot supports multiple environments:

| Environment | Notes |
|-------------|-------|
| **Linux (system)** | Default deployment target |
| **Termux (Android)** | Special Puppeteer config required |
| **Windows** | Supported but not primary target |

Check environment detection in `src/client/environment.js`.

---

## Project Structure

```
manybot/
├── src/
│   ├── main.js                 # Entry point
│   ├── config.js               # Configuration loader
│   ├── client/                 # WhatsApp client layer
│   ├── kernel/                 # Core bot logic
│   ├── plugins/                # Plugin directory
│   ├── utils/                  # Utility functions
│   ├── logger/                 # Logging system
│   ├── i18n/                   # Internationalization
│   ├── locales/                # Core translations
│   └── download/               # Download queue
├── docs/                       # Documentation
├── setup                       # Installation script
├── manybot.conf.example        # Configuration template
└── package.json                # Dependencies
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed component descriptions.

---

## Making Changes

### Branch Naming

Use descriptive branch names:

```
feature/plugin-i18n-improvements
fix/qr-code-display-bug
docs/update-installation-guide
refactor/message-handler-cleanup
```

### Before Submitting

1. **Test your changes** - Run the bot and verify functionality
2. **Check for errors** - Ensure no new warnings or errors in logs
3. **Update documentation** - Add/modify docs if behavior changes
4. **Follow code style** - Match existing code conventions

### Code Style

- **Indentation**: 2 spaces
- **Quotes**: Double quotes for strings
- **Semicolons**: Always use semicolons
- **Comments**: Minimal, only for non-obvious logic
- **Functions**: Use async/await for asynchronous code
- **Imports**: Group imports logically (config, utils, modules)

```javascript
// Good example
import { CMD_PREFIX } from "../../config.js";
import { logger } from "../../logger/logger.js";

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "hello")) return;

  api.log.info("Hello command received");
  await msg.reply("Hello! 👋");
}
```

---

## Commit Guidelines

### Commit Message Format

ManyBot uses Conventional Commits format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting) |
| `refactor` | Code refactoring without behavior change |
| `test` | Adding or updating tests |
| `chore` | Build/config changes |

### Examples

```bash
# Feature
feat(i18n): add Spanish translation for core messages

# Bug fix
fix(plugin-loader): handle missing plugin folder gracefully

# Documentation
docs(plugins): add examples for plugin API usage

# Breaking change
feat(config)!: change PLUGINS format to JSON array
```

### Generating Changelog

```bash
npm run changelog
```

---

## Pull Request Process

### Before Creating a PR

1. **Rebase on latest main**:
   ```bash
   git fetch origin
   git rebase origin/main
   ```

2. **Test thoroughly** - Ensure bot runs without errors

3. **Update CHANGELOG.md** if adding features or fixing bugs

4. **Check for conflicts** - Resolve any merge conflicts locally

### PR Title

Use the same format as commit messages:

```
feat: add plugin hot-reload support
fix: prevent crash on invalid message type
docs: update ARCHITECTURE.md with new diagrams
```

### PR Description

Include:

- **Summary**: What does this PR do?
- **Changes**: List of key changes
- **Testing**: How was it tested?
- **Screenshots**: If applicable (UI changes)
- **Related Issues**: Reference any related issues

### Review Process

1. Maintainer reviews code and provides feedback
2. Address all review comments
3. Request re-review after changes
4. PR is merged when approved

---

## Plugin Development

### Creating a New Plugin

1. **Create plugin folder**:
   ```bash
   mkdir -p src/plugins/my-plugin
   ```

2. **Add manifest** (`manyplug.json`):
   ```json
   {
     "name": "my-plugin",
     "version": "1.0.0",
     "category": "utility",
     "service": false,
     "dependencies": {}
   }
   ```

3. **Create plugin code** (`index.js`):
   ```javascript
   import { CMD_PREFIX } from "../../config.js";

   export default async function ({ msg, api }) {
     if (!msg.is(CMD_PREFIX + "hello")) return;
     await msg.reply("Hello!");
   }
   ```

4. **Add to config** (`manybot.conf`):
   ```bash
   PLUGINS=[
       my-plugin
   ]
   ```

### Plugin Guidelines

- **Single responsibility**: Each plugin should do one thing well
- **Graceful degradation**: Handle errors without crashing
- **Logging**: Use `api.log` for debugging
- **Translations**: Use i18n for user-facing messages
- **Documentation**: Add README for complex plugins

See [docs/PLUGINS.md](docs/PLUGINS.md) for complete plugin guide.

---

## Reporting Issues

### Before Reporting

1. **Search existing issues** - Your issue may already be reported
2. **Check documentation** - The answer might be in the docs
3. **Test with latest version** - Update and reproduce

### Issue Template

When creating an issue, include:

```markdown
## Description
Brief description of the issue

## Steps to Reproduce
1. Step one
2. Step two
3. Expected vs actual behavior

## Environment
- Node.js version:
- ManyBot version:
- OS: (Linux/Termux/Windows)
- Configuration: (relevant parts of manybot.conf)

## Logs
Relevant log output (use code blocks)

## Additional Context
Any other relevant information
```

### Issue Labels

Issues are labeled to help with triage:

- `bug` - Something isn't working
- `enhancement` - New feature request
- `documentation` - Documentation improvements
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention needed
- `question` - Further information requested

---

## Testing

### Manual Testing

1. **Start the bot** in a test environment
2. **Send test messages** to trigger functionality
3. **Check logs** for errors or warnings
4. **Verify edge cases** (empty input, special characters, etc.)

### Testing Checklist

- [ ] Bot starts without errors
- [ ] QR code / pairing code displays correctly
- [ ] Messages are logged properly
- [ ] Plugins load and execute
- [ ] Error handling works (invalid input, missing files)
- [ ] Configuration changes take effect
- [ ] i18n works for all supported languages

---

## Documentation

### Documentation Standards

- **Clarity**: Write for users with basic Node.js knowledge
- **Examples**: Include code examples for all features
- **Screenshots**: Add visual aids when helpful
- **Updates**: Keep docs in sync with code changes

### Documentation Files

| File | Purpose |
|------|---------|
| `README.md` | Project overview and quick start |
| `ARCHITECTURE.md` | Technical architecture details |
| `CONTRIBUTING.md` | Contribution guidelines |
| `docs/INSTALLATION.md` | Installation instructions |
| `docs/CONFIGURATION.md` | Configuration reference |
| `docs/PLUGINS.md` | Plugin development guide |
| `docs/API.md` | Plugin API reference |

### Writing Documentation

- Use clear headings and sections
- Include code blocks with syntax highlighting
- Add tables for options/parameters
- Link to related documentation
- Keep language simple and direct

---

## Areas Needing Contribution

### High Priority

- **Unit tests** - Add test suite for core components
- **TypeScript migration** - Add type definitions
- **Performance optimization** - Reduce memory usage
- **Error handling** - Improve error messages and recovery

### Medium Priority

- **New plugins** - Community-requested features
- **Documentation** - Tutorials and examples
- **i18n** - Additional language support
- **CI/CD** - Automated testing pipeline

### Nice to Have

- **Web dashboard** - Browser-based management
- **Database integration** - Persistent plugin state
- **REST API** - External integrations
- **Docker support** - Container deployment

---

## Getting Help

- **Documentation**: Check existing docs first
- **Issues**: Ask questions in GitHub Issues
- **Discussions**: Use GitHub Discussions for ideas

---

## Recognition

Contributors are recognized in:

- **CHANGELOG.md** - Notable contributions mentioned
- **README.md** - Core contributors section
- **Release notes** - Contributors thanked in releases

---

## License

By contributing to ManyBot, you agree that your contributions will be licensed under the GPL-3.0 License. See [LICENSE](LICENSE) for details.

---

## Thank You!

Every contribution, no matter how small, helps make ManyBot better. Thank you for being part of the community!
