# handspan

Mouse sensitivity tools that run in the browser: a converter between games (cm/360°), a short test that narrows a sensitivity range, a click-accuracy practice, and a move/attack alternation practice. Korean and English.

브라우저에서 쓰는 마우스 감도 도구예요. 게임 간 감도 변환(cm/360°), 짧은 테스트로 감도 범위 찾기, 클릭 정확도 연습, 이동·공격 교대 연습이 있어요. 한국어와 영어를 지원해요.

## Status

- Game coefficients come from converter sites and are shown with their source count. Their independence and in-game accuracy are **not verified**. See the About page.
- Measurements include browser, mouse and display latency. The 3% tolerance and 0.25 s stall threshold are temporary values.
- **Not verified yet:** an end-to-end run with a real mouse, in-game accuracy of the coefficients, and the GitHub Actions / Pages deployment itself.
- No analytics or ads. Records stay in the browser (localStorage). Fonts are self-hosted.

## Build

Node 22 or later, no dependencies.

```sh
node --test test/*.test.mjs   # tests
node build.mjs         # builds dist/ for the server root
HS_SITE=https://example.github.io HS_BASE=/handspan/ node build.mjs   # sub-path build
```

On Git Bash for Windows, prefix the sub-path build with `MSYS_NO_PATHCONV=1`.

Game data lives in `src/data/games.json`. A game with no sources or with conflicting sources (`conflict`) is left out of the build.

## License

Code: MIT (see `LICENSE`). Fonts in `src/assets/fonts/`: SIL Open Font License 1.1 (see `src/assets/fonts/LICENSES.md`).
