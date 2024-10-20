import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

async function main() {
  /**
   * config file(.dotfilesrc)과 설정값들을 모아놓은 폴더(.dotfiles)의 상대 경로 기준이 되는 경로
   */
  const baseDirectory = os.homedir();
  /**
   * 복사 대상이 되는 파일이나 폴더 목록이 담긴 파일
   */
  const configFilename = '.dotfilesrc';
  /**
   * 복사 대상이 되는 파일이나 폴더를 모으는 폴더
   */
  const destinationFolderName = '.dotfiles';
  /**
   * 주석을 나타내는 문자열
   */
  const commentString = '#';

  const rcFile = fs.readFileSync(
    path.join(baseDirectory, configFilename),
    'utf8',
  );

  /**
   * ################################################################
   * ## .dotfilesrc 파일에서 읽어온 타겟 파일 목록 (예시)
   * ################################################################
   *
   * ## 폴더
   * .nvm
   * .git
   * .oh-my-zsh
   * .vim
   * .hammerspoon
   *
   * ## 파일
   * .gitconfig
   * .zshrc
   * .vimrc
   *
   */
  const sourcePathList = rcFile
    .split('\r') // 윈도우 개행문자 제거
    .join('') // 윈도우 개행문자 제거
    .split('\n') // 개행문자로 분리
    .map((line) => line.trim()) // 앞뒤 공백 제거
    .filter((line) => line) // 빈 줄 제거
    .filter((line) => !line.startsWith(commentString)); // 주석 제거

  const destDirectory = path.join(baseDirectory, destinationFolderName);
  if (fs.existsSync(destDirectory)) {
    throw new Error(`${destDirectory} is already exist.`);
  }
  fs.mkdirSync(destDirectory);

  for (const sourceRelativePath of sourcePathList) {
    const source = path.join(baseDirectory, sourceRelativePath);
    try {
      const stats = fs.lstatSync(source);
      const destination = path.join(
        baseDirectory,
        destinationFolderName,
        sourceRelativePath,
      );
      if (stats.isDirectory()) {
        fs.copySync(source, destination);
      } else {
        fs.copyFileSync(source, destination);
      }
      console.log(`${sourceRelativePath}: copied`);
    } catch (error: any) {
      console.error(`${sourceRelativePath}: ${error?.message}`);
    }
  }
}

main();
