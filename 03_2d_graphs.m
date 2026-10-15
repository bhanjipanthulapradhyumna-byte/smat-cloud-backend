% Multiple curves, labels, legend, grid
clc; clear; close all;
x = 0:0.01:2*pi;
y1 = sin(x);
y2 = cos(x);
plot(x,y1,'b-',x,y2,'r--');
title('Sine and cosine');
xlabel('x (radians)'); ylabel('Amplitude');
legend('sin(x)','cos(x)'); grid on;
