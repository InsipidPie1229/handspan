# handspan

Mouse sensitivity tools that run in the browser: a converter between 59 games (cm/360°, plus games you measure yourself), zoom/scope sensitivity matching, game-pair conversion pages, a short test that narrows a sensitivity range, a just-for-fun "game age" mini-game test, a click-accuracy practice and a move/attack alternation practice. Korean and English.

브라우저에서 쓰는 마우스 감도 도구예요. 59개 게임 감도 변환(cm/360°, 직접 잰 게임 추가 가능), 줌·스코프 감도, 게임별 변환 페이지, 감도 범위 찾기, 재미용 게임 나이 테스트, 클릭 정확도 연습, 이동·공격 교대 연습이 있어요. 한국어와 영어를 지원해요.

## Status

- Game coefficients come from converter sites and are shown with their source count. Their independence and in-game accuracy are **not verified**. See the About page.
- Measurements include browser, mouse and display latency. The 3% tolerance and 0.25 s stall threshold are temporary values.
- **Not verified yet:** an end-to-end run with a real mouse and in-game accuracy of the coefficients.
- No analytics or ads. Records stay in the browser (localStorage). Fonts are self-hosted.

## Build

Node 22 or later, no dependencies.

```sh
node --test test/*.test.mjs   # tests
node build.mjs         # builds dist/ for the server root
HS_SITE=https://example.github.io HS_BASE=/handspan/ node build.mjs   # sub-path build
```

On Git Bash for Windows, prefix the sub-path build with `MSYS_NO_PATHCONV=1`.

## Deploy

The site is served by GitHub Pages from the `gh-pages` branch: https://insipidpie1229.github.io/handspan/

```sh
node scripts/deploy.mjs   # test, sub-path build, commit dist/ to gh-pages, push, check live URLs
```

The CI workflow only tests and builds; it does not deploy.

Game data lives in `src/data/games.json`. A game with no sources or with conflicting sources (`conflict`) is left out of the build.

## License

Code: MIT (see `LICENSE`). Fonts in `src/assets/fonts/`: SIL Open Font License 1.1 (see `src/assets/fonts/LICENSES.md`).
