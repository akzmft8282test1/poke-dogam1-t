const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const FAVORITES_FILE = path.join(__dirname, 'data', 'favorites.json');

// 데이터 폴더 및 파일 초기화
function initStorage() {
    if (!fs.existsSync(path.join(__dirname, 'data'))) {
        fs.mkdirSync(path.join(__dirname, 'data'));
    }
    if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));
    if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, JSON.stringify({}));
    if (!fs.existsSync(FAVORITES_FILE)) fs.writeFileSync(FAVORITES_FILE, JSON.stringify({}));
}
initStorage();

const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// 크롤링 함수
async function fetchPokemon(id) {
    try {
        const url = `https://pokemonkorea.co.kr/pokedex/view/${id}`;
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);
        
        const h3Tag = $('.bx-content.row').find('h3');
        if (!h3Tag.length) throw new Error("포켓몬을 찾을 수 없습니다.");
        
        const number = h3Tag.find('p.font-lato').text().trim();
        let name = h3Tag.clone().children().remove().end().text().trim(); 

        return { id, number, name, url };
    } catch (error) {
        return { id, number: 'Unknown', name: '데이터 없음 또는 오류', url: '#' };
    }
}

// 회원가입 / 로그인 / 로그아웃
app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    const users = readJSON(USERS_FILE);
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ success: false, message: '이미 존재하는 계정입니다.' });
    }
    users.push({ username, password, admin: false });
    writeJSON(USERS_FILE, users);
    res.json({ success: true, message: '회원가입 완료!' });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(400).json({ success: false, message: '정보가 일치하지 않습니다.' });
    
    res.cookie('username', username, { httpOnly: true });
    res.json({ success: true, username, isAdmin: !!user.admin });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('username');
    res.json({ success: true });
});

// 인증 미들웨어
function auth(req, res, next) {
    const username = req.cookies.username;
    if (!username) return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    req.username = username;
    const users = readJSON(USERS_FILE);
    req.user = users.find(u => u.username === username);
    next();
}

// 포켓몬 뽑기
app.post('/api/pokemon/roll', auth, async (req, res) => {
    let targetId;
    const { customId } = req.body;

    if (req.user.admin && customId) {
        targetId = parseInt(customId);
        if (isNaN(targetId) || targetId < 1 || targetId > 1300) {
            return res.status(400).json({ success: false, message: '1~1300 사이의 숫자를 입력하세요.' });
        }
    } else {
        targetId = Math.floor(Math.random() * 1300) + 1;
    }

    const pokemonData = await fetchPokemon(targetId);
    res.json({ success: true, pokemon: pokemonData });
});

// 보관함 저장
app.post('/api/pokemon/save', auth, (req, res) => {
    const { pokemon } = req.body;
    const history = readJSON(HISTORY_FILE);
    if (!history[req.username]) history[req.username] = [];
    
    if (history[req.username].some(p => p.id === pokemon.id)) {
        return res.json({ success: true, message: '이미 보관함에 있습니다.' });
    }
    
    history[req.username].push({ ...pokemon, savedAt: new Date().toISOString() });
    writeJSON(HISTORY_FILE, history);
    res.json({ success: true, message: '보관함에 저장되었습니다!' });
});

app.get('/api/pokemon/history', auth, (req, res) => {
    const history = readJSON(HISTORY_FILE);
    res.json({ success: true, history: history[req.username] || [] });
});

// 🌟 [추가] 즐겨찾기 토글 (등록 / 해제) API
app.post('/api/pokemon/toggle-favorite', auth, (req, res) => {
    const { pokemon } = req.body;
    if (!pokemon) return res.status(400).json({ success: false, message: '데이터가 없습니다.' });

    const favorites = readJSON(FAVORITES_FILE);
    if (!favorites[req.username]) favorites[req.username] = [];

    const index = favorites[req.username].findIndex(p => p.id === pokemon.id);
    let isAdded = false;

    if (index > -1) {
        // 이미 즐겨찾기에 있으면 삭제
        favorites[req.username].splice(index, 1);
    } else {
        // 없으면 추가
        favorites[req.username].push(pokemon);
        isAdded = true;
    }

    writeJSON(FAVORITES_FILE, favorites);
    res.json({ 
        success: true, 
        isAdded, 
        message: isAdded ? '즐겨찾기에 추가되었습니다 ★' : '즐겨찾기에서 제거되었습니다 ☆' 
    });
});

// 🌟 [추가] 즐겨찾기 목록 조회 API
app.get('/api/pokemon/favorites', auth, (req, res) => {
    const favorites = readJSON(FAVORITES_FILE);
    res.json({ success: true, favorites: favorites[req.username] || [] });
});

app.listen(PORT, () => console.log(`서버 오픈: http://localhost:${PORT}`));
