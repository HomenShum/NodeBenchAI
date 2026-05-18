import React from "react";
import { Composition } from "remotion";
import { NodeBenchDemo } from "./compositions/NodeBenchDemo";
import { FPS, totalFrames } from "./storyboard";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="NodeBenchDemo"
        component={NodeBenchDemo}
        durationInFrames={totalFrames}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{}}
      />
      {/* Quick preview — first 30 seconds */}
      <Composition
        id="NodeBenchPreview"
        component={NodeBenchDemo}
        durationInFrames={30 * FPS}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{}}
      />
    </>
  );
};
