import re
with open('doc/ACP-USAGE-GUIDE.md', 'rb') as f:
    content = f.read()
content = content.replace(b'\\x07', b'code>')
content = content.replace(b'Ignores patterns: dotfiles, \\node', b'Ignores patterns: dotfiles, code>node')
with open('doc/ACP-USAGE-GUIDE.md', 'wb') as f:
    f.write(content)
print('Done')
