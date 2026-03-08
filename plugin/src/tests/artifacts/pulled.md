# Comprehensive Roundtrip Test

This document tests all major formatting features supported by the Joplin Google Docs plugin.

## Basic Formatting

This paragraph contains **bold text**, *italic text*, and ***bold italic*** together.
Here's some `inline code` in a sentence.

## Links

### External Links

Visit [Google](https://www.google.com) for search.
Check out [GitHub](https://github.com) for code.

### Joplin Internal Links

Reference to [another note](:/abc123def456) in Joplin.
Link to [resource file](:/image789resource) attachment.

## Images

### External Image

![External cat](https://placekitten.com/200/200)

### Joplin Internal Image
![My screenshot](:/88a9c8449f054280ad2c402f451b5373)

## Unordered Lists

### Simple Unordered List

- First item
- Second item
- Third item with longer text that might wrap

### Nested Unordered List

- Level 1 item A
    - Level 2 item A1
    - Level 2 item A2
        - Level 3 deeply nested
    - Level 2 item A3
- Level 1 item B
- Level 1 item C
    - Level 2 under C

## Ordered Lists

### Simple Ordered List

1. First numbered item
2. Second numbered item
3. Third numbered item

### Nested Ordered List

1. Main point one
    1. Sub-point 1.1
    2. Sub-point 1.2
        1. Deep sub-point 1.2.1
2. Main point two
3. Main point three
    1. Sub-point 3.1

## Mixed Content in Lists

### List with Image (same bullet)

- Item with text followed by image
![inline image](:/imageInListItem123)
- Next regular item
- Another item

### List Followed by Different Content

- List item one
- List item two
- List item three

## Heading After List

This paragraph comes right after the list above.

### Another Heading

More content here.

## Code Blocks

### Code without language
```
function hello() {
    console.log("Hello world");
}
```

### JavaScript Code
```javascript
const greeting = (name) => {
    return `Hello, ${name}!`;
};
console.log(greeting("World"));
```

### Python Code
```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))
```

### Consecutive Code Blocks
```javascript
const a = 1;
```
```python
b = 2
```
```
plain code block
```

### Consecutive Plain Code Blocks
```
first plain block
```
```
second plain block
```
```
third plain block
```

## Callout Blocks
<note>This is a note callout with important information for the reader.</note>
<info>This is an info callout providing additional context.</info>
<warning>This is a warning callout about potential issues.</warning>
<tip>This is a tip callout with helpful suggestions.</tip>
<question>This is a question callout for the reader to consider.</question>
<jarvis>This is a jarvis callout with AI-generated content.</jarvis>

## Complex Mixed Section

Here's a paragraph before a complex nested structure.

1. First ordered item with **bold** and *italic*
- Nested unordered under ordered
- Another nested item
1. Second ordered item
    1. Nested ordered 2.1
    2. Nested ordered 2.2

Then some regular text between lists.

- Unordered after ordered
- With [a link](https://example.com) inside
- And some `inline code` too

## Final Section

### H3 Heading

#### H4 Heading

##### H5 Heading

###### H6 Heading

This is the final paragraph of the test document.