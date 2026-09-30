import { describe, expect, it } from 'vitest'
import { inspectCode, scanPython } from './code-policy'

const kinds = (code: string) => [...new Set(inspectCode(code).map((c) => c.kind))].sort()

describe('scanPython', () => {
  it('blanks comments and string contents but keeps offsets and line breaks', () => {
    const src = `x = "a # b"  # note\ny = '''two\nlines''' + f"{z}"`
    const { code, strings } = scanPython(src)
    expect(code).toHaveLength(src.length)
    expect(code.split('\n')).toHaveLength(src.split('\n').length)
    expect(code).not.toContain('note')
    expect(code).not.toContain('a # b')
    expect(strings.map((s) => s.text)).toEqual(['a # b', 'two\nlines', '{z}'])
    expect(src.slice(strings[1].at, strings[1].at + 3)).toBe("'''")
  })

  it('keeps escaped quotes inside a string', () => {
    expect(scanPython(String.raw`s = "say \"hi\" to .env"`).strings[0].text).toBe(String.raw`say \"hi\" to .env`)
  })
})

describe('inspectCode', () => {
  it.each([
    'open(".env").read()',
    'pd.read_csv(f"{root}/.ENV.local")',
    'open("config\\\\.env")',
    'key = (Path.home() / ".ssh" / "id_rsa").read_text()',
    'open(os.path.expanduser("~/.ssh/config"))',
    'open("id_ed25519")',
    'open(r"C:\\Users\\me\\.aws\\credentials")',
    "open(os.path.expanduser('~/.netrc'))",
    'import netrc',
    'import keyring\nkeyring.get_password("svc", "me")',
    'keyring.get_password("svc", "me")',
    'from dotenv import load_dotenv\nload_dotenv()',
    'values = dotenv.dotenv_values()',
    'open("/Users/me/Library/Keychains/login.keychain-db", "rb")',
    'subprocess.run(["security", "find-generic-password", "-s", "openai"])',
  ])('flags secret access in %s', (code) => {
    expect(kinds(code)).toContain('secret')
  })

  it.each([
    'import subprocess\nsubprocess.run(["ls"])',
    'from subprocess import run',
    'subprocess.check_output("pip list", shell=True)',
    'os.system("ls")',
    'print(os.popen("whoami").read())',
    'from os import system',
    '!pip install seaborn',
    '%pip install seaborn',
    '  !ls -la',
    'import pip\npip.main(["install", "seaborn"])',
    '__import__("subprocess").run(["ls"])',
    'importlib.import_module("subprocess")',
    'await asyncio.create_subprocess_exec("ls")',
    'get_ipython().system("ls")',
    'get_ipython().run_line_magic("sx", "ls")',
    'get_ipython().run_cell_magic("bash", "", "ls")',
    'import os, subprocess',
  ])('flags shell commands in %s', (code) => {
    expect(kinds(code)).toEqual(['shell'])
  })

  it.each([
    'import requests\nrequests.get("https://example.com")',
    'r = requests.get(url, timeout=5)',
    'import pandas as pd, requests',
    'import requests as rq',
    'from urllib.request import urlopen',
    'from urllib import request',
    'import urllib.request',
    'urllib.request.urlretrieve(url, "x.csv")',
    'data = urlopen(url).read()',
    'import httpx',
    'with httpx.Client() as client: pass',
    'import socket',
    's = socket.create_connection(("example.com", 80))',
    'import aiohttp',
    'from http.client import HTTPSConnection',
    'from http import client',
    'import urllib3',
  ])('flags network use in %s', (code) => {
    expect(kinds(code)).toEqual(['network'])
  })

  it.each([
    'env = pd.read_csv("environment.csv")',
    'open("data/.envrc").read()',
    'open("notes.env")',
    'open("my.env/data.csv")',
    'home = os.environ.get("HOME")',
    'os.environ["MPLBACKEND"] = "agg"',
    'from urllib.parse import urlparse',
    'from http import HTTPStatus',
    'daily = logs.groupby("day").requests.sum()',
    'logs["requests"].describe()',
    'requests.head()',
    'logs.socket.value_counts()',
    'print("use subprocess or requests")',
    '# import requests\n# os.system("ls")\nx = 1',
    'x = (a\n     != b)',
    'df.query("status != \'ok\'")',
    'load = df.system.mean()',
    'pd.read_csv("id_rsa_counts.csv")',
    'pd.read_csv("ssh_sessions.csv")',
    'import os\nos.path.join("a", "b")',
    'orders.groupby("month").total.mean()',
    'import numpy as np, pandas as pd',
    'from collections import Counter',
    'subsystem.run()',
  ])('allows %s', (code) => {
    expect(inspectCode(code)).toEqual([])
  })

  it('names the line it found', () => {
    expect(inspectCode('import pandas as pd\n\nr = requests.get(url)\nr.json()')).toEqual([{ kind: 'network', what: 'uses the network', line: 'r = requests.get(url)' }])
  })
})
