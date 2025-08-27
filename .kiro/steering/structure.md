# Project Structure

This document defines the organization and folder structure conventions for the project.

## Current Structure
```
.
├── .git/           # Git version control
└── .kiro/          # Kiro AI assistant configuration
    └── steering/   # AI guidance documents
```

## Recommended Structure
As the project develops, consider organizing code using these conventions:

```
.
├── src/            # Source code
├── tests/          # Test files
├── docs/           # Documentation
├── config/         # Configuration files
├── scripts/        # Build and utility scripts
├── assets/         # Static assets (images, etc.)
└── dist/           # Build output (generated)
```

## File Naming Conventions
- Use lowercase with hyphens for directories: `my-component/`
- Follow language-specific conventions for file names
- Keep names descriptive but concise
- Use consistent extensions based on file type

## Code Organization
- Group related functionality together
- Separate concerns (business logic, UI, data access)
- Use clear module boundaries
- Follow established patterns for the chosen technology stack

## Documentation
- README.md in root for project overview
- API documentation alongside code
- Architecture decisions in docs/ folder
- Inline comments for complex logic

---
*This structure should evolve as the project grows and requirements become clearer.*